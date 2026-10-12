#!/usr/bin/env node
// Disposable PostgreSQL single-spec diagnosis. NOT the full preflight/CI gate.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

export function probeArgs(args, exists = existsSync) {
  if (args.length === 0) throw new Error('Select at least one tests/*.test.ts file.');
  const unique = [...new Set(args)];
  for (const file of unique) {
    if (!/^tests\/[\w/-]+\.test\.[cm]?[jt]sx?$/.test(file) || file.includes('..') || !exists(file))
      throw new Error('Invalid or missing test file: ' + file);
  }
  return unique;
}

export function commandFor(files) {
  return ['bash', 'scripts/local-postgres-test.sh', '--checks', '--inside',
    ...files.flatMap(file => ['--db', file])];
}

export function main(args, execute = spawnSync) {
  const files = probeArgs(args);
  const command = commandFor(files);
  process.stdout.write('DIAGNOSTIC PROBE ONLY: ' + files.length +
    ' explicit DB spec(s); not publication preflight or exact-head CI.\n');
  const start = process.hrtime.bigint();
  const result = execute(command[0], command.slice(1),
    { stdio: 'inherit', timeout: 600_000, env: { ...process.env, CI: 'true' } });
  process.stdout.write('Probe elapsed seconds: ' +
    (Number(process.hrtime.bigint() - start) / 1e9).toFixed(1) + '\n');
  if (result.error || result.signal || result.status !== 0) {
    process.stderr.write('Disposable-DB probe failed; no passing evidence.\n');
    return 1;
  }
  process.stdout.write('Focused probe passed. Run normal preflight and exact-head CI before merge.\n');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
