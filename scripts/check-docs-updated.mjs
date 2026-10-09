#!/usr/bin/env node
// "Docs describe the merged state" gate (Chris, 2026-10-09). A PR that changes the application must
// update the documentation as if it were already merged, so main's docs are accurate the moment it lands.
// Escape hatch for a genuinely doc-neutral change: a line in the PR description starting with
// "Docs-update: not needed" followed by the reason.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function missingDocs(changed, prBody = '') {
  const app = changed.some(p => /^(src|prisma)\//.test(p));
  if (!app) return [];
  if (/^\s*Docs-update:\s*not needed\b.{8,}/im.test(prBody)) return [];
  const missing = [];
  if (!changed.includes('docs/STATUS.md')) missing.push('docs/STATUS.md (what this PR merged, what is next)');
  if (!changed.some(p => /^docs\/pr-cards\/.+\.(md|json)$/.test(p)))
    missing.push('docs/pr-cards/<card>.md or work-index.json (card marked done / status updated)');
  if (changed.includes('prisma/schema.prisma') && !changed.includes('docs/DATABASE.md'))
    missing.push('docs/DATABASE.md (schema changed)');
  return missing;
}

function main() {
  const [base, head] = process.argv.slice(2);
  if (!base || !head) throw new Error('Usage: node scripts/check-docs-updated.mjs <base-sha> <head-sha>');
  const changed = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
  let body = '';
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8'));
    body = event.pull_request?.body ?? '';
  } catch { /* not a pull_request event: no escape hatch text */ }
  const missing = missingDocs(changed, body);
  if (missing.length) {
    console.error('This PR changes the app but not the docs that describe it once merged. Update in this PR:');
    for (const item of missing) console.error(`  - ${item}`);
    console.error('See docs/implementation-contracts/DRIFT-PROTOCOL.md checklist B. If truly not needed, add');
    console.error('"Docs-update: not needed — <reason>" to the PR description.');
    process.exit(1);
  }
  console.log('Docs updated alongside the change (or not required).');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
