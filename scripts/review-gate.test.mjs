import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, lastChangeAt, numbersFor, parseCodexState, CODEX_BOT } from './review-gate.mjs';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const T0 = '2026-10-27T10:00:00Z'; // head commit time
const minutesAfter = (m) => new Date(Date.parse(T0) + m * 60000).toISOString();
const pr = { number: 7, draft: false, user: { login: 'christcr2012' }, head: { sha: HEAD } };
const summary = (sha, status, at = minutesAfter(1)) => ({
  user: { login: CODEX_BOT }, created_at: at,
  body: `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 {"code_review":{"commit_sha":"${sha}","status":"${status}"},"security_review":{"commit_sha":null}} -->\n## Codex Review Summary`,
});
const finding = (id, at = minutesAfter(5)) => ({ id, user: { login: CODEX_BOT }, in_reply_to_id: null, created_at: at, body: '**P1** something' });
const reply = (to, id = to + 100, at = minutesAfter(8)) => ({ id, user: { login: 'christcr2012' }, in_reply_to_id: to, created_at: at, body: 'Fixed in abc123.' });
const selfNote = (at) => ({ user: { login: 'christcr2012' }, author_association: 'OWNER', created_at: at, body: 'Automated review unavailable - waived; self-reviewed at HEAD.' });
const run = (extra) => evaluate({ pr, headCommitAt: T0, now: minutesAfter(10), ...extra });

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
  const result = run({ issueComments: [summary(HEAD, 'completed')] });
  assert.equal(result.state, 'success');
});

test('an unanswered Codex finding blocks, whatever else is true; a reply clears it', () => {
  const comments = { issueComments: [summary(HEAD, 'completed')], reviewComments: [finding(1), finding(2)] };
  assert.match(run(comments).description, /2 Codex findings still need a reply/);
  assert.equal(run(comments).state, 'failure');
  const oneAnswered = { ...comments, reviewComments: [finding(1), reply(1), finding(2)] };
  assert.match(run(oneAnswered).description, /1 Codex finding still needs|1 Codex finding still need/);
  const allAnswered = { ...comments, reviewComments: [finding(1), reply(1), finding(2), reply(2)] };
  assert.equal(run(allAnswered).state, 'success');
});

test('a bot cannot answer its own finding', () => {
  const botReply = { id: 9, user: { login: CODEX_BOT }, in_reply_to_id: 1, created_at: minutesAfter(6), body: 'resolved' };
  assert.equal(run({ issueComments: [summary(HEAD, 'completed')], reviewComments: [finding(1), botReply] }).state, 'failure');
});

test('Codex reviewed an older commit: needs a self-review note written after the last push', () => {
  const base = { issueComments: [summary(OLD, 'completed', minutesAfter(-30))], reviewComments: [finding(1, minutesAfter(-25)), reply(1, 101, minutesAfter(-20))] };
  assert.equal(run(base).state, 'failure');
  const before = { ...base, issueComments: [...base.issueComments, selfNote(minutesAfter(-10))] };
  assert.equal(run(before).state, 'failure', 'a note from before the last push does not count');
  const after = { ...base, issueComments: [...base.issueComments, selfNote(minutesAfter(9))] };
  assert.equal(run(after).state, 'success');
});

test('Codex usage limit: waived immediately once the author self-reviewed, blocked until then', () => {
  const limit = { user: { login: CODEX_BOT }, created_at: minutesAfter(1), body: 'You have reached your Codex usage limits for code reviews.' };
  const blocked = run({ issueComments: [limit] });
  assert.equal(blocked.state, 'failure');
  assert.match(blocked.description, /self-reviewed/);
  const waived = run({ issueComments: [limit, selfNote(minutesAfter(9))] });
  assert.deepEqual([waived.state, waived.description], ['success', 'Automated review unavailable - waived; self-reviewed.']);
});

test('a limit message from before the last push does not condemn the new push', () => {
  const stale = { user: { login: CODEX_BOT }, created_at: minutesAfter(-60), body: 'You have reached your Codex usage limits.' };
  assert.equal(run({ issueComments: [stale] }).state, 'pending');
});

test('no Codex answer after the wait window falls back to the self-review note', () => {
  const late = { now: minutesAfter(40) };
  assert.equal(run({ ...late, issueComments: [] }).state, 'failure');
  assert.equal(run({ ...late, issueComments: [selfNote(minutesAfter(30))] }).state, 'success');
  assert.equal(run({ ...late, issueComments: [summary(HEAD, 'running')] }).state, 'failure');
});

test('unanswered findings still block when Codex is otherwise unavailable and a note exists', () => {
  const late = { now: minutesAfter(40), issueComments: [selfNote(minutesAfter(30))], reviewComments: [finding(3)] };
  assert.equal(run(late).state, 'failure');
});

test('a stranger saying "self-review" does not count', () => {
  const stranger = { user: { login: 'someone-else' }, author_association: 'NONE', created_at: minutesAfter(30), body: 'self-reviewed lol' };
  assert.equal(run({ now: minutesAfter(40), issueComments: [stranger] }).state, 'failure');
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

test('syncing with main does not count as a new push; real changes do', () => {
  const commit = (date, parents = 1) => ({ parents: Array.from({ length: parents }, (_, i) => ({ sha: String(i) })), commit: { committer: { date } } });
  assert.equal(lastChangeAt([commit('2026-10-27T10:00:00Z'), commit('2026-10-27T11:00:00Z', 2)]), '2026-10-27T10:00:00Z');
  assert.equal(lastChangeAt([commit('2026-10-27T10:00:00Z'), commit('2026-10-27T11:00:00Z', 2), commit('2026-10-27T12:00:00Z')]), '2026-10-27T12:00:00Z');
  assert.equal(lastChangeAt([commit('2026-10-27T11:00:00Z', 2)]), '2026-10-27T11:00:00Z');
  assert.equal(lastChangeAt([]), null);
});
