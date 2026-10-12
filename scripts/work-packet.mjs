// Bounded, checked execution packets. This is navigation and validation, never approval.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { parse as preflightOptions } from './preflight.mjs';

const text = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000 || /[\x00-\x08\x0b-\x1f]/.test(value))
    throw new Error('Missing/invalid ' + label);
  return value;
};
const array = (value, label) => {
  if (!Array.isArray(value) || value.length > 80) throw new Error('Missing/invalid ' + label);
  return value;
};
const idPattern = /^[A-Z][A-Z0-9-]{0,60}$/;

export function safePath(root, name, mustExist = true) {
  if (typeof name !== 'string' || !/^[\w./()[\]@-]+$/.test(name) || isAbsolute(name) || name.split('/').some(p => !p || p === '.' || p === '..') || name.startsWith('.'))
    throw new Error('Unsafe repository path');
  const full = resolve(root, name);
  let parent = full;
  // Check existing parents too, so a proposed file under an escaping symlink is refused.
  while (!existsSync(parent)) {
    const next = resolve(parent, '..');
    if (next === parent) throw new Error('Missing repository root');
    parent = next;
  }
  const rel = relative(realpathSync(root), realpathSync(parent));
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('Path escapes repository');
  if (rel.split(sep).some(p => ['.git', 'node_modules', '.next', 'coverage'].includes(p) || /^\.env(?:\.|$)/.test(p)))
    throw new Error('Protected private/generated reference path');
  if (mustExist && !existsSync(full)) throw new Error('Missing repository file: ' + name);
  return full;
}

export function validatePacket(packet, root) {
  if (!packet || packet.version !== 1 || !idPattern.test(packet.id) || !idPattern.test(packet.parent)) throw new Error('Invalid packet identity/version');
  if (!/^[a-f0-9]{40}$/.test(packet.baseline)) throw new Error('Packet needs an inspected full baseline SHA');
  for (const field of ['outcome', 'risk', 'next']) text(packet[field], field);
  safePath(root, packet.card);
  const references = array(packet.references, 'references');
  if (!references.length || references.length > 12) throw new Error('Packet needs 1–12 bounded existing integration references');
  for (const ref of references) {
    const full = safePath(root, ref.path);
    text(ref.anchor, 'reference anchor');
    if (!readFileSync(full, 'utf8').includes(ref.anchor)) throw new Error('Stale reference: ' + ref.path + ' :: ' + ref.anchor);
    text(ref.purpose, 'reference purpose');
  }
  const proposed = array(packet.proposedFiles, 'proposedFiles');
  for (const file of proposed) safePath(root, file, false);
  for (const field of ['invariants', 'sequence', 'acceptance']) {
    const entries = array(packet[field], field);
    if (!entries.length) throw new Error('Packet needs ' + field);
    for (const entry of entries) text(entry, field);
  }
  for (const gate of array(packet.gates, 'gates')) {
    if (!idPattern.test(gate.id)) throw new Error('Invalid gate ID');
    for (const field of ['affected', 'remedy', 'reopen']) text(gate[field], 'gate ' + field);
    safePath(root, gate.source);
  }
  const checks = packet.checks;
  if (!checks || Object.keys(checks).some(k => !['unit', 'db', 'browser', 'node'].includes(k))) throw new Error('Invalid check categories');
  let count = 0;
  for (const kind of ['unit', 'db', 'browser', 'node']) for (const file of array(checks[kind], kind + ' checks')) {
    count++;
    if (kind === 'node') {
      if (!/^scripts\/[\w/-]+\.test\.mjs$/.test(file)) throw new Error('Invalid node check selector');
    } else preflightOptions(['--' + kind, file]);
    safePath(root, file, !proposed.includes(file));
  }
  if (!count) throw new Error('Packet needs meaningful checks');
  return packet;
}

export function loadPacket(root, index, id = index.activeExecution) {
  if (!idPattern.test(id ?? '')) throw new Error('No active execution packet: write the current card and register it in work-index.json');
  const entry = (index.executionPackets ?? []).find(p => p.id === id);
  if (!entry) throw new Error('Unknown execution packet: ' + id);
  const packet = validatePacket(JSON.parse(readFileSync(safePath(root, entry.path), 'utf8')), root);
  if (packet.id !== entry.id || !index.cards.some(c => c.id === packet.parent)) throw new Error('Packet must belong to its indexed acceptance unit');
  return packet;
}

export function validatePackets(root, index) {
  const entries = array(index.executionPackets, 'executionPackets');
  if (new Set(entries.map(p => p.id)).size !== entries.length) throw new Error('Duplicate execution packet IDs');
  if (!entries.some(p => p.id === index.activeExecution)) throw new Error('Active execution packet is not registered');
  return entries.map(p => loadPacket(root, index, p.id));
}

export function checkArguments(packet, root, { plan = false, fresh = false } = {}) {
  const missing = Object.values(packet.checks).flat().filter(p => !existsSync(safePath(root, p, false)));
  if (missing.length && !plan) throw new Error('Implement planned regression files before verification: ' + missing.join(', '));
  const args = ['scripts/preflight.mjs', ...(plan ? ['--plan'] : []), ...(fresh ? ['--fresh'] : [])];
  for (const kind of ['unit', 'db', 'browser']) for (const file of packet.checks[kind]) args.push('--' + kind, file);
  return { args, missing, node: packet.checks.node };
}

export function renderPacket(packet) {
  const sections = [
    `Execution ${packet.id} (${packet.parent}) — ${packet.outcome}`,
    `Inspected baseline: ${packet.baseline}\nCard: ${packet.card}\nRisk: ${packet.risk}`,
    'Read only these integration points (work read <number>):\n' + packet.references.map((r, i) => `${i + 1}. ${r.path} :: ${r.anchor} — ${r.purpose}`).join('\n'),
    'Preserve:\n' + packet.invariants.map(s => '- ' + s).join('\n'),
    'Implement together:\n' + packet.sequence.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    'Prove:\n' + packet.acceptance.map(s => '- ' + s).join('\n'),
    'Scoped gates:\n' + packet.gates.map(g => `- ${g.id}: ${g.affected}\n  Remedy: ${g.remedy}\n  Reopen: ${g.reopen} (${g.source})`).join('\n'),
    'Planned new files (not implementation evidence):\n' + packet.proposedFiles.map(s => '- ' + s).join('\n'),
    'Next: ' + packet.next,
    'Packet validation is navigation only. Recheck actual main, PRs, reviews and owner inputs; never infer acceptance, authorization or merge eligibility from this packet.',
  ];
  return sections.join('\n\n');
}

export function referenceExcerpt(packet, number, root) {
  if (!/^[1-9]\d?$/.test(String(number))) throw new Error('Select a numbered reference from work start');
  const ref = packet.references[Number(number) - 1];
  if (!ref) throw new Error('Reference number is outside this packet');
  const lines = readFileSync(safePath(root, ref.path), 'utf8').split('\n');
  const anchor = lines.findIndex(line => line.includes(ref.anchor));
  if (anchor < 0) throw new Error('Stale reference: ' + ref.path);
  const start = Math.max(0, anchor - 12), end = Math.min(lines.length, anchor + 90);
  return `${ref.path} :: ${ref.anchor} (first matching anchor, lines ${start + 1}–${end})\n` +
    lines.slice(start, end).map((line, n) => `${start + n + 1}: ${line}`).join('\n');
}
