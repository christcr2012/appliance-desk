// Bounded local orientation/publication check. Never runs tests or provider calls.
import { readFileSync, existsSync, readdirSync, accessSync, constants } from 'node:fs';
import { totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { getHeapStatistics } from 'node:v8';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function resourceProfile(read = path => readFileSync(path, 'utf8'), hostBytes = totalmem(), heapBytes = getHeapStatistics().heap_size_limit) {
  const limits = [hostBytes];
  for (const path of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    try { const n = Number(read(path).trim()); if (Number.isSafeInteger(n) && n > 0) limits.push(n); } catch { /* unavailable on this host */ }
  }
  return { memoryMiB: Math.floor(Math.min(...limits) / 1048576), heapMiB: Math.floor(heapBytes / 1048576) };
}

export function prepare(root) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const scripts = manifest.scripts ?? {};
  const commands = Object.fromEntries(['check', 'check:quick', 'test', 'test:db', 'test:rtc', 'test:e2e', 'preflight', 'work']
    .filter(name => scripts[name]).map(name => [name, 'npm run ' + name]));
  const executable = path => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } };
  const roots = (process.env.PATH ?? '').split(':').filter(Boolean);
  try { for (const version of readdirSync('/usr/lib/postgresql')) roots.push('/usr/lib/postgresql/' + version + '/bin'); } catch { /* no local installation */ }
  const postgresBinaries = roots.some(path => ['initdb', 'pg_ctl', 'psql'].every(name => executable(join(path, name))));
  const schemaPath=join(root,'prisma/schema.prisma'), generatedPath=join(root,'node_modules/.prisma/client/schema.prisma');
  let generatedPrismaClient='NOT_APPLICABLE';
  if(existsSync(schemaPath)){
    const schema=readFileSync(schemaPath,'utf8');
    generatedPrismaClient=/provider\s*=\s*"prisma-client-js"/.test(schema)&&!/output\s*=/.test(schema)
      ? existsSync(generatedPath)&&schema.replace(/\s+/g,'')===readFileSync(generatedPath,'utf8').replace(/\s+/g,'') ? 'CURRENT' : 'MISSING_OR_STALE'
      : 'CHECK_CONFIGURED_GENERATOR';
  }
  return {
    node: process.version, requiredNode: manifest.engines?.node ?? 'See the existing CI Node version',
    generatedPrismaClient, resources: resourceProfile(), dependenciesInstalled: existsSync(join(root, 'node_modules')),
    localPostgresBinaries: postgresBinaries,
    disposableDatabaseLauncher: existsSync(join(root, 'scripts/local-postgres-test.sh')),
    browserLauncher: existsSync(join(root, 'scripts/local-browser-test.mjs')),
    commands,
    next: [
      ...(generatedPrismaClient==='MISSING_OR_STALE'?['Generated Prisma client is missing/stale after schema/main changed. Use the existing generation/postinstall command with isolated fixture configuration before typecheck; do not run a database migration or use real provider credentials.']:[]),
      'Use the selected existing card/packet: fixed consumer checklist, complete fixture and focused commands. Do not audit the whole repository again.',
      postgresBinaries ? 'Local PostgreSQL binaries found; verify the existing isolated launcher prerequisites/user before use. Never substitute a hosted database.' : 'Local PostgreSQL server binaries absent: use the existing authorized disposable test runner or exact-head database CI; do not retry unavailable local DB modes.',
      'Choose one supported build/browser route. After resource termination, diagnose once and use the documented runner/required CI fallback; do not cycle build flags or substitute a dev-server pass.',
      'This reports capabilities, not a working database/browser, permission, test pass, or deployment acceptance.'
    ]
  };
}

function invoke(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  // Git diagnostics can include credential-bearing remote URLs: do not echo them.
  if (r.error || r.signal || r.status === null) throw Error('Git operation unavailable: ' + args[0] + '; inspect connectivity/tool support privately. No fresh publication check.');
  return r;
}

export function publication(root, git = args => invoke(root, args)) {
  const required = args => { const r = git(args); if (r.status !== 0) throw Error('Git ' + args[0] + ' failed; reconcile privately. No fresh publication check.'); return r.stdout.trim(); };
  // Refresh only the actual target tracking ref; do not move local branches or live.
  required(['fetch', 'origin', 'main:refs/remotes/origin/main']);
  if (required(['status', '--porcelain'])) throw Error('Commit the coherent local checkpoint or resolve edits/conflicts before the publication comparison.');
  const head = required(['rev-parse', 'HEAD']), main = required(['rev-parse', 'origin/main']);
  const base = required(['merge-base', head, main]);
  const incoming = required(['diff', '--name-only', base, main]).split('\n').filter(Boolean);
  const outgoing = required(['diff', '--name-only', base, head]).split('\n').filter(Boolean);
  const preview = git(['merge-tree', '--write-tree', '--name-only', head, main]);
  if (![0, 1].includes(preview.status)) throw Error('Git merge-tree unavailable; use the existing isolated integration workflow before publication.');
  return { status: preview.status === 1 ? 'RECONCILE_CONFLICTS' : incoming.length ? 'REVIEW_MAIN_ADVANCE' : 'PUBLICATION_BASE_CURRENT',
    head, main, commonBase: base, incomingFiles: incoming.length,
    overlap: outgoing.filter(path => incoming.includes(path)).slice(0, 30),
    note: preview.status === 1 ? 'Resolve current-main conflicts before spending a CI cycle. No merge, local branch or worktree was changed; origin/main was refreshed.' :
      'No textual conflict predicted. Review incoming shared contracts/fixtures and integrate relevant changes; this does not prove semantic compatibility, CI or merge readiness.' };
}

export function run(root, args) {
  if (args.length && (args.length !== 1 || args[0] !== '--publish')) throw Error('Usage: npm run session:prepare [-- --publish]');
  return args.length ? publication(root) : prepare(root);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = run(resolve(fileURLToPath(new URL('..', import.meta.url))), process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2)); if (result.status === 'RECONCILE_CONFLICTS') process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
