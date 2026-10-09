#!/usr/bin/env node
// Fast check (no test runner) that every App Router page is listed in e2e/route-inventory.ts, which drives the
// accessibility browser suite. Runs in the pre-push quick gate, so a new page is caught in seconds with the exact
// line to paste, instead of failing tests/accessibility-route-inventory.test.ts later in CI (Sol, 2026-10-09).
//   node scripts/check-route-inventory.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export function pageRoutes(appDir = join(process.cwd(), 'src', 'app')) {
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name === 'page.tsx' ? [full] : [];
  });
  return walk(appDir).map(file => {
    const segments = relative(appDir, file).split(sep).slice(0, -1)
      .filter(segment => !(segment.startsWith('(') && segment.endsWith(')')));
    return segments.length ? `/${segments.join('/')}` : '/';
  }).sort();
}

export function inventoryRoutes(source) {
  return [...source.matchAll(/^\s*(?:\{\s*)?path:\s*"([^"]+)"/gm)].map(match => match[1]).sort();
}

/** A ready-to-paste entry; dynamic routes get a manual-only placeholder the author must complete. */
export function suggestion(route) {
  const role = route.startsWith('/desk') ? 'OWNER' : route.startsWith('/portal') ? 'CUSTOMER' : 'PUBLIC';
  if (!route.includes('[')) return `  { path: "${route}", role: "${role}", fixture: "${route}" },`;
  return `  { path: "${route}", role: "${role}", fixture: "<describe the record a tester needs>", manualOnlyReason: "<why CI cannot visit a stable URL for this page>" },`;
}

export function compare(pages, listed) {
  const seen = new Set();
  const duplicates = listed.filter(route => seen.has(route) || !seen.add(route));
  return {
    missing: pages.filter(route => !listed.includes(route)),
    stale: [...new Set(listed)].filter(route => !pages.includes(route)),
    duplicates: [...new Set(duplicates)],
  };
}

function main() {
  const { missing, stale, duplicates } = compare(pageRoutes(), inventoryRoutes(readFileSync('e2e/route-inventory.ts', 'utf8')));
  if (!missing.length && !stale.length && !duplicates.length) {
    console.log('Route inventory: every page is listed.');
    return;
  }
  if (missing.length) {
    console.error('New pages missing from e2e/route-inventory.ts (accessibility tests). Add to ACCESSIBILITY_ROUTES:');
    for (const route of missing) console.error(suggestion(route));
    console.error('Check the role, and for STAFF-only pages use role "STAFF".');
  }
  if (stale.length) console.error(`Listed but no longer a page (remove them): ${stale.join(', ')}`);
  if (duplicates.length) console.error(`Listed more than once: ${duplicates.join(', ')}`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
