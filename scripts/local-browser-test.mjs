#!/usr/bin/env node
// Called inside local-postgres-test.sh; never provisions external infrastructure.
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { run, verifyBrowserReport } from './preflight.mjs';
import { BUILD_PATHSPEC, buildIsCurrent, codeFingerprint, markBuild } from './check-cache.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'appliance-browser-'));
try {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
  if (process.env.CI !== 'true' || url.hostname !== 'localhost' || url.pathname !== '/appliance_desk_test')
    throw new Error('Browser preflight requires the disposable localhost database launcher.');
  // Next loads these itself: do not accidentally import real provider credentials.
  for (const name of ['.env', '.env.local', '.env.production', '.env.production.local'])
    if (existsSync(name)) throw new Error(`Local browser preflight refuses ${name}. Use a clean isolated worktree without deployment environment files.`);
  const files = process.argv.slice(2);
  if (!files.length || files.some(f => !/^e2e\/[\w/-]+\.spec\.ts$/.test(f) || !existsSync(f))) throw new Error('Select existing e2e/*.spec.ts files.');
  if (process.env.LOCAL_TEST_CHROMIUM) {
    if (!existsSync(process.env.LOCAL_TEST_CHROMIUM)) throw new Error('LOCAL_TEST_CHROMIUM does not exist.');
    process.env.APPLIANCE_DESK_TEST_CHROMIUM = resolve(process.env.LOCAL_TEST_CHROMIUM);
  } else {
    const { chromium } = await import('@playwright/test');
    if (!existsSync(chromium.executablePath())) throw new Error('No matching installed Chromium. Set LOCAL_TEST_CHROMIUM to the preinstalled sandbox binary; never install a browser in the sandbox.');
  }
  if (process.env.LOCAL_TEST_FONT) {
    const font = resolve(process.env.LOCAL_TEST_FONT);
    if (!existsSync(font) || !font.endsWith('.woff2')) throw new Error('LOCAL_TEST_FONT must be an existing .woff2 stand-in.');
    const css = `@font-face { font-family: 'Manrope'; font-style: normal; font-weight: 200 800; font-display: swap; src: url(${JSON.stringify(font)}) format('woff2'); }`;
    const mock = join(scratch, 'font-mock.cjs');
    writeFileSync(mock, `module.exports = new Proxy({}, { get: () => ${JSON.stringify(css)} });\n`);
    process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES = mock;
  }
  // Reuse the production build when nothing that affects it changed (tests, specs and docs don't); --fresh rebuilds.
  const buildKey = `${codeFingerprint(BUILD_PATHSPEC)}:${process.env.LOCAL_TEST_FONT ? 'stand-in-font' : 'real-font'}`;
  if (!process.env.APPLIANCE_DESK_FRESH && buildIsCurrent(buildKey)) {
    console.log('✓ reusing the production build: no source change since it was built');
  } else {
    if (process.env.LOCAL_TEST_FONT) run(['npx', '--no-install', 'next', 'build', '--webpack']);
    else run(['npm', 'run', 'build']);
    markBuild(buildKey);
  }
  if (process.env.LOCAL_TEST_FONT) console.log('Local webpack/stand-in-font proof only; CI real-font production build remains required.');
  const patterns = files.map(f => `/${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  rmSync('playwright-results.json', { force: true });
  run(['npx', '--no-install', 'playwright', 'test', ...patterns]);
  verifyBrowserReport(JSON.parse(readFileSync('playwright-results.json', 'utf8')));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { rmSync(scratch, { recursive: true, force: true }); }
