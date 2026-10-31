#!/usr/bin/env node
import { runConformance } from '../src/run.js';

const usage = 'Usage: rtc-conformance <url> --pass-env NAME ' +
  '[--read-only-pass-env NAME] [--expired-pass-env NAME] [--revoked-pass-env NAME]';
const flags = { '--pass-env': 'full', '--read-only-pass-env': 'readOnly',
  '--expired-pass-env': 'expired', '--revoked-pass-env': 'revoked' };
export async function main(argv = process.argv.slice(2), env = process.env) {
  const [url, ...options] = argv;
  if (!url || options.length % 2 || options.length === 0 || !/^https?:\/\//.test(url)) {
    console.error(usage); return 2;
  }
  const passes = {};
  const seen = new Set();
  for (let i = 0; i < options.length; i += 2) {
    const flag = options[i];
    const name = options[i + 1];
    if (!flags[flag] || seen.has(flag) || !/^[A-Z_][A-Z0-9_]*$/.test(name || '') ||
      !env[name]) {
      console.error(usage); return 2;
    }
    seen.add(flag);
    passes[flags[flag]] = env[name];
  }
  if (!passes.full) { console.error(usage); return 2; }
  try {
    const result = await runConformance({ url, passes });
    for (const check of result.checks) {
      console.log((check.skipped ? 'SKIP' : check.ok ? 'PASS' : 'FAIL') +
        ' ' + check.name + ': ' + check.message);
    }
    return result.ok ? 0 : 1;
  } catch {
    console.error('Conformance failed before checks could complete'); return 1;
  }
}
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  process.exitCode = await main();
}
