#!/usr/bin/env node
// Dependency-free entrypoint: no npm install, secrets, providers or database needed to orient.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { commands, parse as preflightOptions, relatedSources } from './preflight.mjs';
import { checkArguments, loadPacket, referenceExcerpt, renderPacket, validatePackets } from './work-packet.mjs';
import { installWorktree } from './install-worktree.mjs';
import { workCheckpoint } from "./work-checkpoint.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 }).trim();

export function changedFiles(root, base = 'origin/main') {
  return [...new Set([
    git(root, ['diff', '--name-only', '-z', base + '...HEAD']),
    git(root, ['diff', '--name-only', '-z', 'HEAD']),
    git(root, ['ls-files', '--others', '--exclude-standard', '-z']),
  ].flatMap(s => s.split('\0')).filter(Boolean))];
}

export function doctor(root) {
  const issues = [];
  let hook = '';
  try { hook = git(root, ['config', '--get', 'core.hooksPath']); }
  catch (error) { if (error.status !== 1) throw error; }
  if (hook !== '.githooks') issues.push('Run npm run setup once in this checkout to install the pre-push gate.');
  const modules = resolve(root, 'node_modules');
  if (!existsSync(modules)) issues.push('Dependencies absent: use npm run work -- install (or --offline with a complete cache); never share a symlinked dependency tree.');
  else if (lstatSync(modules).isSymbolicLink()) issues.push('node_modules is a symlink: remove only this worktree link and run work install before React/browser proof.');
  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  for (const key of ['dependencies', 'devDependencies']) {
    if (JSON.stringify(lock.packages?.['']?.[key] ?? {}) !== JSON.stringify(manifest[key] ?? {}))
      issues.push('package.json and package-lock.json disagree on ' + key + '; reconcile before npm ci.');
  }
  if (git(root, ['ls-files', '-u'])) issues.push('Unresolved Git conflicts: preserve work and reconcile before recording proof.');
  return { node: process.version, branch: git(root, ['branch', '--show-current']), head: git(root, ['rev-parse', 'HEAD']), issues,
    note: 'Local setup diagnosis only; no credentials, database, hosted environment or real-provider acceptance inspected.' };
}

export function continuation(packet, head) {
  if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('Invalid local head');
  return `Resume christcr2012/appliance-desk from actual current main. Local checkpoint ${head} is not proof of GitHub merge or CI. Reconcile open PRs, concurrent work and unresolved reviews first. Read AGENTS.md, docs/SESSION-START.md and the current handoff at the top of docs/STATUS.md; run npm run work -- start. Next recorded outcome: ${packet.outcome} (${packet.id}); refresh the packet against current code and owner inputs. Follow the approved scope, scoped-blocker recovery, safeguards and outcome-led PR sizing; complete the bundle workload requested in the current owner prompt (if any), without counting PRs, helpers or repairs as bundles. Update the existing execution packet/card and STATUS inside the implementation PR, keep implementation separate from real acceptance, and finish eligible session obligations, then end with a verified checkpoint and compact permanent handoff.`;
}

export function main(args, root = ROOT, execute = spawnSync, output = console.log) {
  const [action = 'start', ...rest] = args;
  const allowed = ['start', 'read', 'route', 'check', 'plan', 'verify', 'probe', 'doctor', 'install', 'drift', 'prompt', 'metrics', 'checkpoint'];
  if (!allowed.includes(action)) throw new Error('Usage: npm run work -- ' + allowed.join('|') + ' [packet-id] [--fresh]');
  if (action === 'install') return installWorktree(rest, root, execute, output);
  const fresh = rest.includes('--fresh');
  const ids = rest.filter(s => s !== '--fresh');
  if (ids.length > 1 || (fresh && action !== 'verify')) throw new Error('Select one packet; --fresh is valid only with verify');
  const index = JSON.parse(readFileSync(resolve(root, 'docs/pr-cards/work-index.json'), 'utf8'));
  if (action === 'read') {
    const packet = loadPacket(root, index);
    output(referenceExcerpt(packet, ids[0], root)); return 0;
  }
  if (action === 'route') {
    const card = index.cards.find(c => c.id === ids[0]);
    if (!card) throw new Error('Select an indexed acceptance unit, e.g. npm run work -- route W-23');
    output(JSON.stringify({ id: card.id, title: card.title, declaredScopeStatus: card.status,
      dependencies: card.dependencies, card: card.card ?? card.plannedCard,
      references: card.evidence, regressionAnchors: card.tests,
      note: 'Discovery anchors, not verified readiness. Reconcile STATUS, approved design headings, actual code and owner inputs; write one current packet using docs/pr-cards/README.md. Never implement proposed scope or skip prerequisite acceptance.' }, null, 2)); return 0;
  }
  if (action === 'check') {
    if (ids.length) loadPacket(root, index, ids[0]); else validatePackets(root, index);
    output('Execution packets checked: current references, parent scope, selectors and scoped gates. Not behavior/acceptance proof.');
    return 0;
  }
  if (action === 'checkpoint') { output(JSON.stringify(workCheckpoint(root), null, 2)); return 0; }
  if (action === 'doctor') {
    const report = doctor(root);
    output(JSON.stringify(report, null, 2)); return report.issues.length ? 1 : 0;
  }
  if (action === 'metrics') {
    const log = git(root, ['rev-parse', '--git-path', 'appliance-checks/preflight-runs.jsonl']);
    const path = resolve(root, log);
    const rows = existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : [];
    const summary = rows.reduce((s, r) => {
      s[r.status] = (s[r.status] ?? 0) + 1; s.elapsedMs += r.elapsedMs; return s;
    }, { records: rows.length, elapsedMs: 0 });
    output(JSON.stringify({ ...summary, note: 'Bounded local check history only; no CI duration or customer acceptance inferred.' }, null, 2)); return 0;
  }
  const packet = loadPacket(root, index, ids[0]);
  if (action === 'start') { output(renderPacket(packet)); return 0; }
  if (action === 'prompt') { output(continuation(packet, git(root, ['rev-parse', 'HEAD']))); return 0; }
  if (action === 'drift') {
    git(root, ['cat-file', '-e', packet.baseline + '^{commit}']);
    const files = changedFiles(root, packet.baseline);
    const relevant = [...new Set([...packet.references.map(r => r.path), ...packet.proposedFiles, packet.card])];
    output(JSON.stringify({ inspectedBaseline: packet.baseline, currentHead: git(root, ['rev-parse', 'HEAD']),
      changedIntegrationFiles: files.filter(p => relevant.includes(p)),
      note: 'Mechanical drift must be reconciled; no changes here do not prove unchanged semantics or owner decisions.' }, null, 2)); return 0;
  }
  const selection = checkArguments(packet, root, { plan: action === 'plan', fresh });
  if (action === 'plan') {
    // commands() also detects unselected screens and adds existing related regressions.
    const changed = changedFiles(root);
    const steps = commands(preflightOptions(selection.args.slice(1)), changed, p => existsSync(resolve(root, p)));
    output(JSON.stringify({ packet: packet.id, explicitSpecs: Object.values(packet.checks).flat().length,
      relatedSourceFiles: relatedSources(changed, p => existsSync(resolve(root, p))).length,
      missingPlannedTests: selection.missing, nodeChecks: selection.node, commands: steps,
      note: 'Plan only. Related-source tests may be much broader than explicit selectors; use probe for diagnosis, then complete normal preflight and exact-head CI.' }, null, 2)); return 0;
  }
  const vectors = action === 'probe'
    ? [[process.execPath, 'scripts/probe-db.mjs', ...packet.checks.db]]
    : [...(selection.node.length ? [[process.execPath, '--test', ...selection.node]] : []), [process.execPath, ...selection.args]];
  if (action === 'probe' && !packet.checks.db.length) throw new Error('Packet has no database specs to probe');
  // No arbitrary commands in packets and no shell: validated selectors only.
  for (const [command, ...commandArgs] of vectors) {
    output('> ' + [command, ...commandArgs].join(' '));
    const result = execute(command, commandArgs, { cwd: root, stdio: 'inherit', timeout: 600000, env: { ...process.env, CI: 'true' } });
    if (result.error || result.signal || result.status !== 0) throw new Error('Selected check failed. No passing evidence; diagnose before retrying.');
  }
  output(action === 'probe' ? 'Diagnostic probe only; full preflight and exact-head CI remain required.' : 'Selected local checks passed; exact-head GitHub CI, review and actual acceptance remain required.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
