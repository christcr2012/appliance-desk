import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, lastChange, namesCommit, numbersFor, parseCodexState, CODEX_BOT } from './review-gate.mjs';

const HEAD = 'a1b2c3d4e5f6'.padEnd(40, '0');
const REAL = 'f0e1d2c3b4a5'.padEnd(40, '1'); // newest non-merge commit when HEAD is a sync merge
const OLD = 'b'.repeat(40);
const T0 = '2026-10-27T10:00:00Z'; // when the gate first saw the head commit
const minutesAfter = (m) => new Date(Date.parse(T0) + m * 60000).toISOString();
const pr = { number: 7, draft: false, user: { login: 'christcr2012' }, head: { sha: HEAD } };
const summary = (sha, status, at = minutesAfter(1)) => ({
  user: { login: CODEX_BOT }, created_at: at,
  body: `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 {"code_review":{"commit_sha":"${sha}","status":"${status}"},"security_review":{"commit_sha":null}} -->\n## Codex Review Summary`,
});
const finding = (id, at = minutesAfter(5)) => ({ id, user: { login: CODEX_BOT }, in_reply_to_id: null, created_at: at, body: '**P1** something' });
const reply = (to, extra = {}) => ({ id: to + 100, user: { login: 'christcr2012' }, author_association: 'OWNER', in_reply_to_id: to, created_at: minutesAfter(8), body: 'Fixed in abc1234.', ...extra });
const selfNote = (sha = HEAD.slice(0, 8), at = minutesAfter(9)) => ({ user: { login: 'christcr2012' }, author_association: 'OWNER', created_at: at, body: `Automated review unavailable - waived; self-reviewed at ${sha}.` });
const run = (extra) => evaluate({ pr, windowStartAt: T0, now: minutesAfter(10), reviewedShas: [HEAD, REAL], ...extra });

test('parses the state Codex writes in its summary comment, and ignores other comments', () => {
  assert.deepEqual(parseCodexState(summary(HEAD, 'running').body), { commitSha: HEAD, status: 'running' });
  assert.equal(parseCodexState('looks good to me'), null);
  assert.equal(parseCodexState('<!-- codex-review-state:v1 {not json} -->'), null);
});

test('a draft never passes', () => {
  assert.equal(run({ pr: { ...pr, draft: true } }).state, 'pending');
});

test('waits for Codex inside the window, then names what it is waiting for', () => {
  assert.match(run({ issueComments: [] }).description, /Waiting for Codex/);
  assert.equal(run({ issueComments: [] }).state, 'pending');
  const running = run({ issueComments: [summary(HEAD, 'running')] });
  assert.deepEqual([running.state, running.description], ['pending', 'Codex review is running.']);
});

test('Codex finished on this commit with no findings: success', () => {
  assert.equal(run({ issueComments: [summary(HEAD, 'completed')] }).state, 'success');
});

test('an unanswered Codex finding blocks; a disposition from the author clears it', () => {
  const comments = { issueComments: [summary(HEAD, 'completed')], reviewComments: [finding(1), finding(2)] };
  assert.match(run(comments).description, /2 Codex findings still need a reply/);
  assert.equal(run(comments).state, 'failure');
  const oneAnswered = { ...comments, reviewComments: [finding(1), reply(1), finding(2)] };
  assert.match(run(oneAnswered).description, /1 Codex finding still needs a reply/);
  const allAnswered = { ...comments, reviewComments: [finding(1), reply(1), finding(2), reply(2)] };
  assert.equal(run(allAnswered).state, 'success');
});

test('only the author or a collaborator can clear a finding, and only with a real disposition', () => {
  const base = { issueComments: [summary(HEAD, 'completed')] };
  const stranger = reply(1, { user: { login: 'someone-else' }, author_association: 'NONE', body: 'I have the same question, fixed?' });
  assert.equal(run({ ...base, reviewComments: [finding(1), stranger] }).state, 'failure', 'a stranger cannot clear it');
  const offTopic = reply(1, { body: 'Thanks, looking into it.' });
  assert.equal(run({ ...base, reviewComments: [finding(1), offTopic] }).state, 'failure', 'a reply with no disposition does not clear it');
  const collaborator = reply(1, { user: { login: 'helper' }, author_association: 'COLLABORATOR', body: 'Superseded by the rewrite.' });
  assert.equal(run({ ...base, reviewComments: [finding(1), collaborator] }).state, 'success');
  const botReply = { id: 9, user: { login: CODEX_BOT }, in_reply_to_id: 1, created_at: minutesAfter(6), body: 'fixed' };
  assert.equal(run({ ...base, reviewComments: [finding(1), botReply] }).state, 'failure', 'a bot cannot answer its own finding');
});

test('Codex reviewed an older commit: needs a self-review note that names the reviewed commit', () => {
  const base = { issueComments: [summary(OLD, 'completed', minutesAfter(-30))], reviewComments: [finding(1, minutesAfter(-25)), reply(1)] };
  assert.equal(run(base).state, 'failure');
  assert.match(run(base).description, /self-reviewed <commit sha>/);
  const wrongCommit = { ...base, issueComments: [...base.issueComments, selfNote(OLD.slice(0, 8))] };
  assert.equal(run(wrongCommit).state, 'failure', 'a note naming an older commit does not vouch for the new head');
  const noSha = { ...base, issueComments: [...base.issueComments, { ...selfNote(), body: 'self-reviewed, looks fine' }] };
  assert.equal(run(noSha).state, 'failure', 'a note that names no commit does not count');
  const named = { ...base, issueComments: [...base.issueComments, selfNote()] };
  assert.equal(run(named).state, 'success');
});

test('an old note cannot vouch for newer code even when the new commit carries an older timestamp', () => {
  // The note was written at 10:00 about REAL; a later push is HEAD (not REAL). Naming REAL must not pass if REAL is no longer the reviewed set.
  const reviewedNow = { reviewedShas: [HEAD, 'c'.repeat(40)], issueComments: [selfNote(REAL.slice(0, 8), minutesAfter(-120))], now: minutesAfter(40) };
  assert.equal(run(reviewedNow).state, 'failure');
});

test('a sync merge does not erase a note that names the last real commit', () => {
  const note = selfNote(REAL.slice(0, 8));
  const result = run({ now: minutesAfter(40), issueComments: [note] });
  assert.deepEqual([result.state, result.description], ['success', 'Automated review unavailable - waived; self-reviewed.']);
});

test('Codex usage limit: waived once the author self-reviewed the commit, blocked until then', () => {
  const limit = { user: { login: CODEX_BOT }, created_at: minutesAfter(1), body: 'You have reached your Codex usage limits for code reviews.' };
  const blocked = run({ issueComments: [limit] });
  assert.equal(blocked.state, 'failure');
  assert.match(blocked.description, /self-reviewed/);
  assert.equal(run({ issueComments: [limit, selfNote()] }).state, 'success');
});

test('a limit message from before this commit appeared does not condemn the new push', () => {
  const stale = { user: { login: CODEX_BOT }, created_at: minutesAfter(-60), body: 'You have reached your Codex usage limits.' };
  assert.equal(run({ issueComments: [stale] }).state, 'pending');
});

test('no Codex answer after the wait window falls back to the self-review note', () => {
  const late = { now: minutesAfter(40) };
  assert.equal(run({ ...late, issueComments: [] }).state, 'failure');
  assert.equal(run({ ...late, issueComments: [selfNote()] }).state, 'success');
  assert.equal(run({ ...late, issueComments: [summary(HEAD, 'running')] }).state, 'failure');
});

test('unanswered findings still block when Codex is otherwise unavailable and a note exists', () => {
  const late = { now: minutesAfter(40), issueComments: [selfNote()], reviewComments: [finding(3)] };
  assert.equal(run(late).state, 'failure');
});

test('a stranger saying "self-reviewed <sha>" does not count', () => {
  const stranger = { user: { login: 'someone-else' }, author_association: 'NONE', created_at: minutesAfter(30), body: `self-reviewed ${HEAD.slice(0, 8)}` };
  assert.equal(run({ now: minutesAfter(40), issueComments: [stranger] }).state, 'failure');
});

test('a note names a commit by a 7+ character hex prefix, nothing shorter or unrelated', () => {
  assert.equal(namesCommit(`self-reviewed ${HEAD.slice(0, 7)}`, [HEAD]), true);
  assert.equal(namesCommit(`self-reviewed ${HEAD.slice(0, 6)}`, [HEAD]), false);
  assert.equal(namesCommit('self-reviewed deadbeef', [HEAD]), false);
  assert.equal(namesCommit('', [HEAD, undefined]), false);
});

test('syncing with main does not count as a change to review; real changes do', () => {
  const commit = (sha, date, parents = 1) => ({ sha, parents: Array.from({ length: parents }, (_, i) => ({ sha: String(i) })), commit: { committer: { date } } });
  assert.equal(lastChange([commit('r1', '2026-10-27T10:00:00Z'), commit('m1', '2026-10-27T11:00:00Z', 2)]).sha, 'r1');
  assert.equal(lastChange([commit('r1', '2026-10-27T10:00:00Z'), commit('m1', '2026-10-27T11:00:00Z', 2), commit('r2', '2026-10-27T12:00:00Z')]).sha, 'r2');
  assert.equal(lastChange([commit('m1', '2026-10-27T11:00:00Z', 2)]).sha, 'm1');
  assert.equal(lastChange([]), null);
});

test('picks the pull requests an event is about, and sweeps all open ones for timers', () => {
  assert.deepEqual(numbersFor('pull_request', { pull_request: { number: 4 } }), [4]);
  assert.deepEqual(numbersFor('pull_request_review', { pull_request: { number: 5 } }), [5]);
  assert.deepEqual(numbersFor('issue_comment', { issue: { number: 6, pull_request: {} } }), [6]);
  assert.deepEqual(numbersFor('issue_comment', { issue: { number: 6 } }), []);
  assert.deepEqual(numbersFor('workflow_run', { workflow_run: { pull_requests: [{ number: 8 }] } }), [8]);
  assert.deepEqual(numbersFor('workflow_run', { workflow_run: { pull_requests: [] } }), []);
  assert.equal(numbersFor('schedule', {}), null);
});
