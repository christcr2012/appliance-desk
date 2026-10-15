#!/usr/bin/env node
// Offline PR throughput measurements and declared outcome verification.
// All evidence here is planning/review data, never CI, provider or owner acceptance.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CARD = 'docs/pr-cards/current-pr-scorecard.json';
const INDEX = 'docs/pr-cards/work-index.json';
const ID = /^[A-Z0-9][A-Z0-9-]{2,79}$/;

function git(root, ...args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); }
  catch (error) { throw new Error('Git measurement unavailable: ' + args.join(' ') + ': ' + (error.stderr?.toString() || error.message).slice(0,350)); }
}

export function productionPath(path) {
  return /^(src\/|prisma\/)/.test(path)
    && !/(^|\/)(__tests__|__mocks__|fixtures|generated)(\/|$)/.test(path)
    && !/\.(test|spec|stories)\.[cm]?[jt]sx?$/.test(path)
    && !/\.snap$/.test(path) && !/migration_lock\.toml$/.test(path);
}

export function parseNumstat(text) {
  const changed = text.split('\0').filter(Boolean);
  let additions = 0, deletions = 0, files = 0;
  for (const record of changed) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/s.exec(record);
    if (!match || !productionPath(match[3]) || match[1] === '-' || match[2] === '-') continue;
    additions += Number(match[1]); deletions += Number(match[2]); files++;
  }
  return { additions, deletions, files };
}

export function measureDiff(root, from, to, tripleDot = false) {
  const range = from + (tripleDot ? '...' : '..') + to;
  return parseNumstat(git(root, 'diff', '--numstat', '-z', '--ignore-all-space', '--no-renames', range));
}

export function mergedImplementationHistory(root, ref = 'origin/main', count = 5) {
  const commits = git(root, 'log', '--first-parent', '-n', '180', '--format=%H%x09%s', ref).trim().split('\n').filter(Boolean);
  const results = [];
  for (const entry of commits) {
    const [sha, title] = entry.split('\t', 2);
    const pr = /^Merge pull request #(\d+)\b/.exec(title ?? '');
    if (!pr) continue;
    const parents = git(root, 'rev-list', '--parents', '-n', '1', sha).trim().split(' ');
    if (parents.length < 3) continue;
    const stats = measureDiff(root, parents[1], sha);
    if (!stats.additions && !stats.deletions) continue; // maintenance-only merges are not product implementation samples
    // Never reuse a previous PR's completion claims. Require a scorecard changed
    // by this merge; historical PRs without evidence count as unknown, not zero.
    let completedSlices = null;
    if (git(root, 'diff', '--name-only', parents[1], sha, '--', CARD).trim() === CARD) {
      try {
        const recorded = JSON.parse(git(root, 'show', sha + ':' + CARD));
        if (recorded.kind === 'implementation' && Array.isArray(recorded.completedSlices))
          completedSlices = recorded.completedSlices.length;
      } catch { /* No supported scorecard history: unknown, never fabricated */ }
    }
    results.push({ pr: Number(pr[1]), completedSlices, ...stats });
    if (results.length >= count) break;
  }
  return results;
}

const nonempty = (value) => typeof value === 'string' && value.trim().length >= 10;
export function validateScorecard(card, packet) {
  if (!card || card.version !== 1 || !['implementation', 'maintenance'].includes(card.kind))
    throw new Error('Scorecard requires version 1 and implementation/maintenance kind');
  if (card.parent !== packet.id) throw new Error('Scorecard parent must match the active execution packet');
  if (!Array.isArray(card.completedSlices) || !Array.isArray(card.remainingEngineering)
      || !Array.isArray(card.externalAcceptance) || !card.remainingEngineering.every(nonempty)
      || !card.externalAcceptance.every(nonempty)) throw new Error('Scorecard missing required outcome/remaining/acceptance arrays');
  const approved = new Map((packet.slices ?? []).map(s => [s.id, s]));
  const seen = new Set();
  for (const slice of card.completedSlices) {
    if (!slice || !ID.test(slice.id) || seen.has(slice.id) || !approved.has(slice.id))
      throw new Error('Duplicate, unapproved or malformed completed slice ID: ' + slice?.id);
    seen.add(slice.id);
    const criteria = approved.get(slice.id).acceptance;
    if (!Array.isArray(slice.acceptanceEvidence) || slice.acceptanceEvidence.length !== criteria.length
        || slice.acceptanceEvidence.some(value => !nonempty(value)))
      throw new Error('Each approved acceptance criterion needs its own concrete evidence reference for ' + slice.id);
  }
  if (card.kind === 'implementation' && !seen.size)
    throw new Error('Implementation PR cannot claim zero completely accepted slices; finish a real slice before counting it');
  if (card.kind === 'maintenance' && seen.size)
    throw new Error('Maintenance PR cannot claim completed product slices');
  if (card.workloadException !== undefined && !nonempty(card.workloadException))
    throw new Error('Workload exception must state the concrete reason');
  if (card.evidence !== undefined && (!Array.isArray(card.evidence) || !card.evidence.every(nonempty)))
    throw new Error('Evidence must contain meaningful references');
  return { kind: card.kind, completedSlices: seen.size, declaredIds: [...seen] };
}

export function validatePRChange(root, base, head = 'HEAD') {
  const changes = git(root, 'diff', '--name-only', base, head, '--', CARD).trim().split('\n');
  if (!changes.includes(CARD))
    throw new Error('Each substantive PR must update the checked outcome scorecard rather than inherit previous claims');
  const card = scorecardFromRoot(root);
  const stats = measureDiff(root, base, head);
  if (card.kind === 'maintenance' && (stats.additions || stats.deletions))
    throw new Error('PR modifies production code but claims maintenance-only status');
  if (card.kind === 'implementation' && !stats.additions && !stats.deletions)
    throw new Error('Implementation PR has no meaningful production-code change; explain and classify legitimate maintenance separately');
  return stats;
}

export function scorecardFromRoot(root) {
  const index = JSON.parse(readFileSync(resolve(root, INDEX), 'utf8'));
  const entry = (index.executionPackets ?? []).find(p => p.id === index.activeExecution);
  if (!entry) throw new Error('Missing active approved execution packet');
  const packet = JSON.parse(readFileSync(resolve(root, entry.path), 'utf8'));
  if (packet.id !== entry.id) throw new Error('Execution packet identity mismatch');
  return validateScorecard(JSON.parse(readFileSync(resolve(root, CARD), 'utf8')), packet);
}

export function renderProgress(root, base = 'origin/main', ref = 'origin/main') {
  const card = scorecardFromRoot(root);
  const history = mergedImplementationHistory(root, ref);
  const current = measureDiff(root, base, 'HEAD', true);
  if (card.kind === 'maintenance' && (current.additions || current.deletions))
    throw new Error('Production source changed in a maintenance-scoped PR: classify actual implementation work honestly');
  const comparable = card.kind === 'implementation' && (current.additions || current.deletions);
  const sample = (comparable ? [current, ...history].slice(0, 5) : history.slice(0, 5));
  const mean = sample.length ? Math.round(sample.reduce((s, r) => s + r.additions, 0) / sample.length) : null;
  const sliceSamples = (comparable ? [card.completedSlices, ...history.map(r => r.completedSlices)] : history.map(r => r.completedSlices))
    .filter(Number.isInteger).slice(0, 5);
  const meanSlices = sliceSamples.length ? (sliceSamples.reduce((a, b) => a + b, 0) / sliceSamples.length).toFixed(1) : 'not available';
  return [
    'PR progress (offline planning; claims require independent acceptance review)',
    'Current: ' + card.kind + '; source +' + current.additions + '/-' + current.deletions + ' across ' + current.files + ' production files',
    'Declared completed packet tasks (not batch-subsection completion): ' + card.completedSlices + ' (' + (card.declaredIds.join(', ') || 'none') + ')',
    'Recent merged implementation PRs: ' + history.map(x => '#' + x.pr + ' +' + x.additions + ' source, ' + (x.completedSlices ?? 'unknown') + ' declared packet tasks').join(', '),
    'Rolling production additions average (' + sample.length + ' measured implementation PRs' + (comparable ? ', including current' : '') + '): ' + (mean ?? 'not available') + '; target 400–800',
    'Rolling declared packet-task average (' + sliceSamples.length + ' evidenced PR scorecards' + (comparable ? ', including current' : '') + '): ' + meanSlices + '; diagnostic only, not batch-subsection throughput. Historical unrecorded tasks remain unknown.',
    'PR workload target: 2–5 fully completed predefined batch subsections (such as H-3 or B-5), not packet-task counts. Verify full subsection scope and evidence independently.',
    'Formatting-only diffs ignored; renames treated as add/delete; incomplete/shallow history must be disclosed, never invented.'
  ].join('\n');
}

function main(argv) {
  let check = false, requireChanged = false, base = 'origin/main', ref = 'origin/main';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') check = true;
    else if (argv[i] === '--require-changed') requireChanged = true;
    else if (argv[i] === '--base' && argv[i + 1]) base = argv[++i];
    else if (argv[i] === '--ref' && argv[i + 1]) ref = argv[++i];
    else throw new Error('Usage: pr-progress.mjs [--check] [--require-changed] [--base REF] [--ref REF]');
  }
  if (requireChanged && !check) throw new Error('--require-changed requires --check');
  if (check) {
    const card = scorecardFromRoot(ROOT);
    if (requireChanged) validatePRChange(ROOT, base, ref);
    return 'Scorecard valid: ' + card.kind + ' / ' + card.completedSlices + ' declared packet tasks. This is not a count of completed batch subsections; full subsection evidence still requires review.';
  }
  return renderProgress(ROOT, base, ref);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(main(process.argv.slice(2))); }
  catch (error) { console.error('PR progress: ' + error.message); process.exitCode = 1; }
}
