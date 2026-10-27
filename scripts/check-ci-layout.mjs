// Deliberately bounded reader for this repo's block-style job map/inline needs.
// Unknown syntax refuses validation; this is not a general YAML parser.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const policy = {"gate": "ci", "parallel": ["secrets", "static", "unit", "e2e"], "allowedPrerequisites": ["classify"], "matrices": {"unit": 4, "e2e": 5}, "maxTimeouts": {"classify": 5, "secrets": 5, "static": 10, "unit": 15, "e2e": 20, "ci": 5}, "timedJobs": ["unit", "e2e"]};

export function checkLayout(source, expected = policy) {
  const body = source.split(/^jobs:\s*$/m)[1];
  if (!body) throw Error('CI needs an explicit jobs map.');
  const matches = [...body.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)];
  const jobs = new Map(matches.map((m,i) => [m[1], body.slice(m.index, matches[i+1]?.index)]));
  const dependencies = block => {
    const match = /^    needs:\s*([^\n]*)$/m.exec(block);
    if (!match) return [];
    const text = match[1].trim();
    if (!/^(\[[\w,'" -]+\]|[\w-]+)$/.test(text)) throw Error('Unsupported needs syntax; review the CI topology guard.');
    return text.replace(/[\[\]'" ]/g,'').split(',').filter(Boolean);
  };
  if (jobs.size !== matches.length) throw Error('Duplicate CI job.');
  for (const id of expected.parallel) {
    if (!jobs.has(id)) throw Error('Missing independent verification family: ' + id);
    if (dependencies(jobs.get(id)).some(dep => !(expected.allowedPrerequisites ?? []).includes(dep)))
      throw Error('Independent verification serialized behind another job: ' + id);
  }
  for (const [id, block] of jobs) {
    const limit = Number(/^    timeout-minutes:\s*(\d+)\s*$/m.exec(block)?.[1]);
    if (!limit || limit > (expected.maxTimeouts[id] ?? 10)) throw Error('Missing/increased CI timeout: ' + id);
    if (/continue-on-error:\s*true|^    if:\s*(?:false|'false'|"false")\s*$/m.test(block)) throw Error('Verification may not silently ignore/disable failure: ' + id);
    for (const dep of dependencies(block)) if (!jobs.has(dep)) throw Error('Unknown dependency: ' + dep);
  }
  for (const match of source.matchAll(/ci-phase\.mjs --budget-seconds (\d+)/g))
    if (Number(match[1]) > 180) throw Error('CI feedback budget increased; profile/split instead.');
  for (const id of expected.timedJobs ?? [])
    if (!/ci-phase\.mjs --budget-seconds \d+ -- /.test(jobs.get(id) ?? '')) throw Error('Missing measured CI phase budget: ' + id);
  const gate = jobs.get(expected.gate);
  if (!gate || !/^    if:\s*always\(\)\s*$/m.test(gate)) throw Error('Required aggregate must run even after failure.');
  const required = [...jobs.keys()].filter(id => id !== expected.gate);
  const needs = dependencies(gate);
  if (needs.length !== required.length || required.some(id => !needs.includes(id))) throw Error('Required aggregate must include EVERY verification job.');
  for (const id of required) if (!gate.includes('needs.' + id + '.result')) throw Error('Aggregate must inspect result: ' + id);
  for (const [id,count] of Object.entries(expected.matrices ?? {})) {
    const block = jobs.get(id);
    if (!/fail-fast:\s*false/.test(block)) throw Error('Collect all shard failures: ' + id);
    const values = /shard:\s*\[([^\]]+)\]/.exec(block)?.[1].split(',').map(v=>v.trim()).filter(Boolean);
    const max = /max-parallel:\s*(\d+)/.exec(block)?.[1];
    const expectedValues = id === 'unit'
      ? Array.from({ length: count }, (_, i) => String(i + 1))
      : Array.from({ length: count }, (_, i) => 'browser-' + String.fromCharCode(97 + i));
    if (!values || values.join(',') !== expectedValues.join(',') || (max && Number(max) < values.length))
      throw Error('Required shards may not collapse, disappear, duplicate or serialize: ' + id);
  }
  return { gate: expected.gate, independentFamilies: expected.parallel, jobs: jobs.size,
    note: 'Topology/timeout guard only; real exact-head CI must pass. Review job/step timings and rebalance growing cohorts, never weaken coverage.' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(checkLayout(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url),'utf8')))); }
  catch(error) { console.error(error.message); process.exitCode=1; }
}
