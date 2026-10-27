// review-gate: the automatic stand-in for "every review comment read" (AGENTS.md section 6), so GitHub's own
// auto-merge can finish a pull request without a person or an agent watching it.
//
// The `review-gate` status on a pull request's head commit is:
//   success - Codex reviewed and every finding has a written reply, OR Codex is unavailable (usage limit, no answer
//             after WAIT_MINUTES) and the author left a "self-reviewed" comment after the last push.
//   pending - Codex is still working (inside the wait window), or the pull request is a draft.
//   failure - a Codex finding has no reply, or Codex was unavailable and no self-review comment exists yet.
// Anyone who adds a reply or a comment re-runs it (see .github/workflows/review-gate.yml).
//
// Public-repo safety: this script only READS pull request data and WRITES one commit status. The workflow runs it
// from the default branch, never from the pull request under review, with no secrets beyond the job's own token.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CODEX_BOT = 'chatgpt-codex-connector[bot]';
export const CONTEXT = 'review-gate';
export const WAIT_MINUTES = 25;
const STATE_MARKER = /<!--\s*codex-review-state:v1\s*(\{[\s\S]*?\})\s*-->/;
const LIMIT_WORDS = /usage limit|rate limit|reached (?:your|the) .{0,40}limit|out of (?:credits|usage)|unable to (?:complete|run|perform)|try again later/i;
const SELF_REVIEW = /self[-\s]?review/i;
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/** The state Codex writes into its summary comment, or null if the comment is not a Codex summary. */
export function parseCodexState(body) {
  const match = STATE_MARKER.exec(String(body ?? ''));
  if (!match) return null;
  try {
    const code = JSON.parse(match[1]).code_review ?? {};
    return { commitSha: code.commit_sha ?? null, status: code.status ?? null };
  } catch {
    return null;
  }
}

const at = (value) => Date.parse(value ?? '') || 0;

/**
 * When the author last changed the code. Merge commits (syncing with main) do not count, so a clean sync never wipes
 * out a self-review note; a pull request that is only merge commits falls back to its newest commit.
 */
export function lastChangeAt(commits) {
  const dates = (list) => list.map((c) => c.commit?.committer?.date).filter(Boolean).sort();
  const real = dates(commits.filter((c) => (c.parents?.length ?? 1) < 2));
  return (real.length ? real : dates(commits)).at(-1) ?? null;
}
const clip = (text) => (text.length <= 140 ? text : `${text.slice(0, 137)}...`);

/**
 * Pure decision. `headCommitAt` is when the newest commit was made; comments before it do not count as a
 * self-review of this code. Returns { state, description }.
 */
export function evaluate({ pr, headCommitAt, now, issueComments = [], reviewComments = [], reviews = [], waitMinutes = WAIT_MINUTES }) {
  const done = (state, description) => ({ state, description: clip(description) });
  if (pr.draft) return done('pending', 'Draft pull request: marked ready for review to merge.');

  const bot = (c) => c?.user?.login === CODEX_BOT;
  const headAt = at(headCommitAt);
  const ageMinutes = (at(now) - headAt) / 60000;

  // 1. Every Codex inline finding needs a written reply from a person/agent (fixed, already fixed, superseded, still open).
  const roots = reviewComments.filter((c) => bot(c) && !c.in_reply_to_id);
  const unanswered = roots.filter((root) => !reviewComments.some((c) => c.in_reply_to_id === root.id && !bot(c)));
  if (unanswered.length > 0) {
    return done('failure', `${unanswered.length} Codex finding${unanswered.length === 1 ? '' : 's'} still need a reply (fixed, already fixed, superseded or still open).`);
  }

  // 2. Where is Codex? Newest summary comment, and any "I hit my limit" message since the last push.
  const botIssue = issueComments.filter(bot);
  const summaries = botIssue.map((c) => ({ c, state: parseCodexState(c.body) })).filter((x) => x.state);
  const latest = summaries.sort((a, b) => at(a.c.created_at) - at(b.c.created_at)).at(-1)?.state ?? null;
  const limitHit = botIssue.some((c) => !STATE_MARKER.test(c.body ?? '') && LIMIT_WORDS.test(c.body ?? '') && at(c.created_at) >= headAt);

  // 3. Did the author leave a self-review note after the last push?
  const trusted = (c) => c?.user?.login === pr.user.login || TRUSTED.has(c?.author_association);
  const notes = [...issueComments, ...reviewComments, ...reviews].filter(
    (c) => !bot(c) && trusted(c) && SELF_REVIEW.test(c.body ?? '') && at(c.created_at ?? c.submitted_at) >= headAt,
  );
  const selfReviewed = notes.length > 0;

  const codexDone = latest?.status === 'completed' && !limitHit;
  if (codexDone) {
    if (latest.commitSha === pr.head.sha) return done('success', 'Codex reviewed this commit and every finding has a reply.');
    return selfReviewed
      ? done('success', 'Codex reviewed an earlier commit; the newer changes are self-reviewed.')
      : done('failure', 'Codex looked at an earlier commit. Comment that you self-reviewed the changes since (after your last push).');
  }

  const waiting = !limitHit && ageMinutes < waitMinutes;
  if (waiting) {
    return done('pending', latest ? 'Codex review is running.' : `Waiting for Codex to review (up to ${waitMinutes} minutes).`);
  }

  // 4. Codex is unavailable: usage limit, or no answer in time. The author's own review stands in for it.
  return selfReviewed
    ? done('success', 'Automated review unavailable - waived; self-reviewed.')
    : done('failure', 'Codex did not review (limit or no answer). Comment that you self-reviewed this change, after your last push.');
}

// ---- GitHub plumbing (only used by the workflow) ----

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.GH_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${(await response.text()).slice(0, 200)}`);
  return response.status === 204 ? null : response.json();
}

async function pages(path) {
  const out = [];
  for (let page = 1; page <= 20; page += 1) {
    const rows = await api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

/** Pull request numbers this event is about; a scheduled/manual run sweeps every open pull request. */
export function numbersFor(eventName, event) {
  if (event.pull_request?.number) return [event.pull_request.number];
  if (eventName === 'issue_comment') return event.issue?.pull_request ? [event.issue.number] : [];
  if (event.workflow_run?.pull_requests?.length) return event.workflow_run.pull_requests.map((p) => p.number);
  if (eventName === 'workflow_run') return [];
  return null;
}

export async function runOne(repo, number, now = new Date().toISOString()) {
  const pr = await api(`/repos/${repo}/pulls/${number}`);
  if (pr.state !== 'open') return null;
  const [issueComments, reviewComments, reviews, commits] = await Promise.all([
    pages(`/repos/${repo}/issues/${number}/comments`),
    pages(`/repos/${repo}/pulls/${number}/comments`),
    pages(`/repos/${repo}/pulls/${number}/reviews`),
    pages(`/repos/${repo}/pulls/${number}/commits`),
  ]);
  const result = evaluate({
    pr, headCommitAt: lastChangeAt(commits), now, issueComments, reviewComments, reviews,
  });
  const statuses = await api(`/repos/${repo}/commits/${pr.head.sha}/statuses?per_page=100`);
  const current = statuses.find((s) => s.context === CONTEXT);
  if (!current || current.state !== result.state || current.description !== result.description) {
    await api(`/repos/${repo}/statuses/${pr.head.sha}`, {
      method: 'POST',
      body: {
        state: result.state, context: CONTEXT, description: result.description,
        target_url: `https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID ?? ''}`,
      },
    });
  }
  console.log(`#${number} ${pr.head.sha.slice(0, 8)} ${result.state}: ${result.description}`);
  return result;
}

export async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const eventName = process.env.GITHUB_EVENT_NAME ?? '';
  const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
  let numbers = numbersFor(eventName, event);
  if (numbers === null) numbers = (await pages(`/repos/${repo}/pulls?state=open`)).map((p) => p.number);
  if (numbers.length === 0) console.log('No pull request to check for this event.');
  for (const number of [...new Set(numbers)]) await runOne(repo, number);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
