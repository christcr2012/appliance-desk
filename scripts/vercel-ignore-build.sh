#!/usr/bin/env bash
# Vercel "Ignored Build Step" (wired in vercel.json → ignoreCommand).
# Exit 0 = skip this deployment, exit 1 = build it (Vercel's convention).
#
# Skips ONLY when every file changed since the last successful deployment of
# this branch is documentation — the same rule CI's `classify` job uses
# (Markdown anywhere, or anything under docs/). The app never reads those
# files at runtime, so the site would be byte-for-byte the same.
# Anything uncertain builds: no previous deployment, a base commit missing
# from Vercel's shallow clone, an empty diff, or any git error.
set -uo pipefail

base="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [[ -z "$base" ]] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  echo "No earlier deployment to compare with: building."
  exit 1
fi

if ! changed="$(git diff --name-only "$base" HEAD)"; then
  echo "Could not compare with ${base}: building."
  exit 1
fi
if [[ -z "$changed" ]]; then
  echo "No file differences found: building to be safe."
  exit 1
fi

while IFS= read -r file; do
  if [[ "$file" != docs/* && "$file" != *.md ]]; then
    echo "App file changed (${file}): building."
    exit 1
  fi
done <<< "$changed"

echo "Only documentation changed since ${base}: skipping this build (the live site would be identical)."
exit 0
