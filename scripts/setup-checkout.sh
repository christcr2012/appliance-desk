#!/usr/bin/env bash
# One-time setup for a checkout or sandbox worktree (npm run setup; npm run hooks:install is the same thing).
# Settings live in this checkout's own git config only.
set -euo pipefail
git config core.hooksPath .githooks          # automatic quick gate before every push
git config http.version HTTP/1.1             # the sandbox's GitHub connection returned HTTP 502 over HTTP/2 (Sol, 2026-10-09)
git config http.postBuffer 157286400         # larger pushes in one request
git config pull.rebase false                 # sync by merging; never rewrite a pushed branch
git config merge.conflictStyle zdiff3        # conflicts show the common original, easier to resolve
echo "Checkout ready: pre-push quick gate on, HTTP/1.1 for GitHub, merge-based syncing."
