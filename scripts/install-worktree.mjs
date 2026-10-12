// Generation needs DIRECT_URL even though installing dependencies must not use a real database.
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function installEnvironment(source = process.env) {
  const env = { ...source, CI: 'true', DATABASE_URL: 'postgresql://test:test@localhost:5432/appliance_desk_test',
    DIRECT_URL: 'postgresql://test:test@localhost:5432/appliance_desk_test' };
  // Keep registry/npm configuration, not application/provider credentials or deployment identity.
  for (const key of Object.keys(env)) if (/^(?:VERCEL(?:_|$)|STRIPE_|TWILIO_|RESEND_|BLOB_|PRIVATE_BLOB_|GOOGLE_|NEON_)/.test(key)) delete env[key];
  return env;
}

export function installWorktree(args, root, execute = spawnSync, output = console.log) {
  if (args.length > 1 || args.some(s => s !== '--offline')) throw new Error('Usage: npm run work -- install [--offline]');
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  if (manifest.scripts?.postinstall !== 'prisma generate') throw new Error('Review changed postinstall behavior before using the safe generation installer.');
  let modules;
  try { modules = lstatSync(resolve(root, 'node_modules')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (modules?.isSymbolicLink()) throw new Error('Remove only this worktree node_modules symlink before installing; never mutate the shared target.');
  const options = { cwd: root, stdio: 'inherit', timeout: 600000, env: installEnvironment() };
  output('Installing this worktree with synthetic localhost generation config; no migration, seed or real database operation.');
  const result = execute('npm', ['ci', '--include=dev', ...args], options);
  if (result.error || result.signal || result.status !== 0) throw new Error('Dependency installation failed. Repair the actual error; offline requires a complete npm cache. No passing setup evidence.');
  output('Worktree dependencies and Prisma generation ready. Run doctor and the capability checks; no feature acceptance inferred.');
  return 0;
}
