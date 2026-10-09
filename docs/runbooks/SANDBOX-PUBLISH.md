# Publishing sandbox work to GitHub (no key, no cut-off files)

For an implementing model that works in the Vercel Sandbox and talks to GitHub through a chat tool (for example Sol in
ChatGPT chat mode). The sandbox clone cannot push, and large files read out through tool responses get cut off. This
route moves **git commits**, packed and split into small fingerprinted pieces, and lets GitHub's own built-in token do
the push. Added 2026-10-09 (Chris: "solve GitHub publishing and file truncation as one infrastructure problem").

**First choice since 2026-10-09:** the sandbox has a push key (STATUS "Environment"), so a plain `git push` from the
sandbox worktree works — run `npm run setup` there once (it sets HTTP/1.1; HTTP/2 pushes returned 502). Use the steps
below when that push is refused (key expired or removed) or for a model with no sandbox access.

## Steps

1. **In the sandbox worktree**, commit your work on a branch named `ai/<tool>/<topic>`, run the PLAYBOOK 4a/4b checks,
   then: `node scripts/sandbox-transfer.mjs pack ai/<tool>/<topic>`
   (Branch older than this script? `git fetch origin main && git show origin/main:scripts/sandbox-transfer.mjs >
   /tmp/sandbox-transfer.mjs` and run `node /tmp/sandbox-transfer.mjs pack …` from the worktree.)
   It prints a folder like `/tmp/sandbox-transfer/<id>/` holding `part-000`, `part-001`, … (40,000 characters each) and
   `manifest.json` (every part's fingerprint). It refuses to pack uncommitted work, an empty change, or a branch that
   does not build on the latest pushed version of the target (then: `git fetch origin <target> && git merge FETCH_HEAD`).
2. **With your GitHub tool**, create the branch `transfer/<id>` from `main`, then upload into its `.transfer/` folder:
   each `part-NNN` (read each with `read_session_file`, write it unchanged), and **`manifest.json` last**. Do not upload
   `transfer.bundle`.
3. **GitHub does the rest** (`.github/workflows/sandbox-publish.yml`, "sandbox publish"): when `manifest.json` arrives it
   checks every part, rebuilds the commits, pushes them to the target branch (fast-forward only), starts CI on it and
   deletes the transfer branch. The first push to a new branch: open the PR with your GitHub tool (that also runs CI).
4. **If the workflow fails**, its log names the problem in plain words: "part-003 is damaged or cut off — upload it
   again" (re-upload that part to the same transfer branch; the workflow re-runs), or "the target moved" (merge it in the
   sandbox and pack again).

## Limits

- Only `ai/*` branches can be targets; `main` never (also blocked by the repository ruleset).
- Changes to `.github/workflows/` cannot travel this way (GitHub's built-in token may not change workflows): ask Chris
  or a session with a normal git checkout.
- Bundles over 20 MB are refused: split the work into smaller PRs.
- CI runs started by this workflow skip the "docs describe the merged state" check (it runs on pull-request events);
  the PR's first CI run includes it, so put the STATUS/card updates in before opening the PR.
- Never copy source files one by one through tool output, and never put a GitHub key in the sandbox.
