#!/usr/bin/env node
// Moves commits from the Vercel Sandbox to GitHub without a GitHub key and without large tool responses
// (Chris, 2026-10-09: "solve GitHub publishing and file truncation as one infrastructure problem").
//
//   pack   (in the sandbox)  node scripts/sandbox-transfer.mjs pack <ai/target-branch> [--base <ref>]
//          → /tmp/sandbox-transfer/<id>/manifest.json + part-000, part-001, … (base64 of one git bundle,
//            each part small enough to read through a tool response without being cut off)
//   unpack (GitHub Actions, .github/workflows/sandbox-publish.yml)
//          node scripts/sandbox-transfer.mjs unpack <dir> <out.bundle>
//          → checks every part's fingerprint, rebuilds the bundle, prints target/head for the workflow.
// The procedure is docs/runbooks/SANDBOX-PUBLISH.md.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PART_CHARS = 40_000; // base64 characters per part
export const MAX_BUNDLE_BYTES = 20 * 1024 * 1024;
const TARGET = /^ai\/[A-Za-z0-9][A-Za-z0-9._\/-]{0,150}$/;
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const PART_NAME = /^part-\d{3}$/;

export const sha256 = data => createHash('sha256').update(data).digest('hex');

export function splitParts(base64, size = PART_CHARS) {
  const parts = [];
  for (let i = 0; i < base64.length; i += size) parts.push(base64.slice(i, i + size));
  return parts;
}

/** Returns a list of plain-English problems; empty means the transfer is complete and intact. */
export function checkTransfer(manifest, files) {
  const problems = [];
  if (manifest?.version !== 1) return ['manifest.json is missing or not version 1'];
  if (typeof manifest.target !== 'string' || !TARGET.test(manifest.target) || manifest.target.includes('..'))
    problems.push('target must be a branch named ai/<something>');
  if (!SHA1.test(manifest.head ?? '')) problems.push('head must be a full commit id');
  if (!SHA1.test(manifest.base ?? '')) problems.push('base must be a full commit id');
  if (!SHA256.test(manifest.bundleSha256 ?? '')) problems.push('bundleSha256 must be a sha256');
  if (!Number.isInteger(manifest.bundleBytes) || manifest.bundleBytes < 1 || manifest.bundleBytes > MAX_BUNDLE_BYTES)
    problems.push(`bundleBytes must be between 1 and ${MAX_BUNDLE_BYTES}`);
  if (!Array.isArray(manifest.parts) || manifest.parts.length < 1) {
    problems.push('parts must list at least one part');
    return problems;
  }
  manifest.parts.forEach((part, index) => {
    const expected = `part-${String(index).padStart(3, '0')}`;
    if (part?.name !== expected) { problems.push(`part ${index} must be named ${expected}`); return; }
    const body = files[part.name];
    if (body === undefined) problems.push(`${part.name} has not been uploaded yet`);
    else if (sha256(body) !== part.sha256) problems.push(`${part.name} is damaged or cut off — upload it again`);
  });
  const extra = Object.keys(files).filter(name => PART_NAME.test(name) && !manifest.parts.some(p => p.name === name));
  if (extra.length) problems.push(`unexpected parts: ${extra.join(', ')}`);
  return problems;
}

export function joinParts(manifest, files) {
  const bundle = Buffer.from(manifest.parts.map(p => files[p.name]).join(''), 'base64');
  if (bundle.length !== manifest.bundleBytes || sha256(bundle) !== manifest.bundleSha256)
    throw new Error('Rebuilt bundle does not match the manifest fingerprint.');
  return bundle;
}

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', ...opts }).trim();
}

function pack(target, baseRef) {
  if (!TARGET.test(target)) throw new Error('Target must be a branch named ai/<something>.');
  if (git(['status', '--porcelain'])) throw new Error('Commit or stash your changes first (git status is not clean).');
  git(['fetch', '--quiet', 'origin', 'main']);
  let base = baseRef;
  if (!base) {
    const remote = git(['ls-remote', 'origin', `refs/heads/${target}`]);
    if (remote) { git(['fetch', '--quiet', 'origin', target]); base = 'FETCH_HEAD'; } else base = 'origin/main';
  }
  const baseSha = git(['rev-parse', base]);
  const head = git(['rev-parse', 'HEAD']);
  try {
    git(['merge-base', '--is-ancestor', baseSha, head], { stdio: 'pipe' });
  } catch {
    throw new Error(`HEAD does not build on ${base}; run "git merge ${base}" first (never rewrite a pushed branch).`);
  }
  const count = Number(git(['rev-list', '--count', `${baseSha}..${head}`]));
  if (count < 1) throw new Error(`Nothing to publish: HEAD has no commits beyond ${base}.`);
  const id = `${target.replace(/[^A-Za-z0-9]+/g, '-')}-${head.slice(0, 8)}`;
  const dir = join('/tmp/sandbox-transfer', id);
  mkdirSync(dir, { recursive: true });
  const bundlePath = join(dir, 'transfer.bundle');
  git(['bundle', 'create', bundlePath, 'HEAD', `^${baseSha}`], { stdio: 'pipe' });
  const bundle = readFileSync(bundlePath);
  if (bundle.length > MAX_BUNDLE_BYTES) throw new Error('Bundle is larger than 20 MB; split the work into smaller PRs.');
  const parts = splitParts(bundle.toString('base64')).map((body, index) => {
    const name = `part-${String(index).padStart(3, '0')}`;
    writeFileSync(join(dir, name), body);
    return { name, sha256: sha256(body) };
  });
  const manifest = { version: 1, target, base: baseSha, head, commits: count, bundleBytes: bundle.length,
    bundleSha256: sha256(bundle), parts };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Packed ${count} commit(s) for ${target} into ${parts.length} part(s) in ${dir}`);
  console.log(`Upload to GitHub branch transfer/${id}, folder .transfer/: every part-NNN first, manifest.json LAST.`);
}

function unpack(dir, out) {
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) { console.log('ready=false'); console.log('reason=manifest.json not uploaded yet'); return; }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const files = {};
  for (const name of readdirSync(dir)) if (PART_NAME.test(name)) files[name] = readFileSync(join(dir, name), 'utf8').trim();
  const problems = checkTransfer(manifest, files);
  if (problems.length) {
    for (const problem of problems) console.error(`transfer problem: ${problem}`);
    process.exit(1);
  }
  writeFileSync(out, joinParts(manifest, files));
  console.log('ready=true');
  console.log(`target=${manifest.target}`);
  console.log(`head=${manifest.head}`);
  console.log(`base=${manifest.base}`);
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'pack') {
    const target = rest[0];
    const baseIndex = rest.indexOf('--base');
    pack(target, baseIndex >= 0 ? rest[baseIndex + 1] : undefined);
  } else if (command === 'unpack') {
    if (rest.length !== 2) throw new Error('Usage: sandbox-transfer.mjs unpack <dir> <out.bundle>');
    unpack(rest[0], rest[1]);
  } else {
    throw new Error('Usage: sandbox-transfer.mjs pack <ai/branch> [--base <ref>] | unpack <dir> <out.bundle>');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
