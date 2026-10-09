#!/usr/bin/env bash
# One-time browser setup for the project's Vercel Sandbox (Ubuntu): Playwright's Chromium plus the system libraries it
# needs, then a real launch check. The persistent sandbox keeps them in its snapshot, so this is only needed when a
# browser check reports "No matching installed Chromium" (2026-10-09: W-0B's browser step was blocked by this).
# Not for Claude Code cloud containers, which ship a preinstalled browser (PLAYWRIGHT_BROWSERS_PATH is set there).
set -euo pipefail
if [ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
  echo "PLAYWRIGHT_BROWSERS_PATH is set: this environment has a preinstalled browser; nothing to do." >&2
  exit 0
fi
npx --no-install playwright install chromium
sudo env "PATH=$PATH" npx --no-install playwright install-deps chromium
node -e "require('@playwright/test').chromium.launch().then(b => b.close()).then(() => console.log('Chromium launches: browser checks can run.'))"
