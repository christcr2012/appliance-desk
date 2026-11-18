#!/usr/bin/env node
// MAP-COUNTS-1 (2026-11-18): every number the relational map states about the code is checked against
// the code at this commit, so the map cannot drift silently (Second Shift review, "shape-6" findings).
//
// docs/relational-map/counts.json lists each stated count:
//   { "name": "tools", "value": 517, "files": ["README.md"],
//     "how": { "command": "python3 scripts/count-catalog.py", "match": "(\\d+) tools" } }
// "how" is one of:
//   { "files": "src/tools/*.js" }                       how many files match a simple glob (* and **)
//   { "matches": "regex", "in": "glob", "flags": "gm" } how many regex matches across those files
//   { "command": "...", "match": "regex with one (\\d+)" } a number read from a command's output
// Checks: (1) each entry's real value equals "value"; (2) each listed map file states that value;
// (3) no map file states a count ("<number> tools|modules|tables|operations|…") that counts.json does not list.
// Exit 1 with the reason on any mismatch. Plain Node, no dependencies; run from the repo root.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

const MAP = 'docs/relational-map';
const WORDS = 'tools?|ops|modules?|tables?|operations?|routes?|sections?|families|endpoints?|scopes?|services?|workers?|repos?|projects?|tests?|files?';
const COUNT_RE = new RegExp(`(?<![\\w.\\-/#:])~?(\\d{2,})\\s+(?:(?:registered|hand-built|catalog(?:ue)?|visible|MCP|vendored|schema)\\s+)?(?:${WORDS})\\b`, 'gi');

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
function glob(pattern) {
  const segs = pattern.split('/');
  const first = segs.findIndex((x) => /[*?]/.test(x));
  const base = (first < 0 ? segs.slice(0, -1) : segs.slice(0, first)).join('/') || '.';
  let re = '';
  for (let i = 0; i < segs.length; i++) {
    const last = i === segs.length - 1;
    if (segs[i] === '**') { re += '(?:[^/]+/)*'; continue; }
    re += segs[i].replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + (last ? '' : '/');
  }
  const rx = new RegExp('^' + re + '$');
  return walk(base).map((p) => relative('.', p).split('\\').join('/')).filter((p) => rx.test(p) && !p.includes('node_modules/'));
}
function actual(how) {
  if (how.files) return glob(how.files).length;
  if (how.matches) {
    const re = new RegExp(how.matches, how.flags ?? 'gm');
    return glob(how.in).reduce((n, f) => n + (readFileSync(f, 'utf8').match(re) ?? []).length, 0);
  }
  if (how.command) {
    const out = execSync(how.command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
    const m = new RegExp(how.match).exec(out);
    if (!m) throw new Error(`"${how.command}" printed nothing matching ${how.match}`);
    return Number(m[1]);
  }
  throw new Error('unknown "how": give files, matches or command');
}

const problems = [];
const spec = JSON.parse(readFileSync(join(MAP, 'counts.json'), 'utf8'));
const listed = new Map(); // file -> Set of stated values
for (const c of spec.counts) {
  let real;
  try { real = actual(c.how); } catch (e) { problems.push(`${c.name}: could not count (${e.message})`); continue; }
  if (real !== c.value) problems.push(`${c.name}: the map says ${c.value}, the code has ${real}. Update docs/relational-map/counts.json and the map text.`);
  for (const f of c.files) {
    const text = readFileSync(join(MAP, f), 'utf8');
    if (!new RegExp(`(?<!\\d)${c.value}(?!\\d)`).test(text)) problems.push(`${c.name}: ${MAP}/${f} does not state ${c.value}`);
    if (!listed.has(f)) listed.set(f, new Set());
    listed.get(f).add(String(c.value));
  }
}
for (const f of readdirSync(MAP).filter((n) => n.endsWith('.md'))) {
  const text = readFileSync(join(MAP, f), 'utf8');
  for (const m of text.matchAll(COUNT_RE)) {
    if (m[0].startsWith('~')) problems.push(`${MAP}/${f}: "${m[0]}" is an approximate count; state the exact number and list it in counts.json`);
    else if (!listed.get(f)?.has(m[1])) problems.push(`${MAP}/${f}: "${m[0]}" is a count that counts.json does not check; add it there or drop the number`);
  }
}
if (problems.length) { console.error('relational map counts out of step with the code:\n- ' + problems.join('\n- ')); process.exit(1); }
console.log(`relational map counts OK: ${spec.counts.length} checked against the code`);
