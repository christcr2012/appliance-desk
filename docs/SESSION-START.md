# SESSION-START — one page to begin (or resume) an implementation session

For Sol 5.6 (or any model) implementing an approved PR card. Read **this page and your card**, then work. Open other
rule files only when a step below names them, a section at a time. `AGENTS.md` still governs; this page is its short
form for card work (Chris, 2026-10-09, after sessions kept stopping during start-up reading).

## 1. Find your place (2 minutes)

Local database testing uses the project's **Vercel Sandbox** (PLAYBOOK 4b has the exact steps; reuse the sandbox named
in STATUS, never create one per card). **Write code only in your own checkout; the sandbox only runs tests** (it can't
push). Push your branch (no PR yet = no CI) and fetch it in the sandbox.


1. `git fetch origin && git status -sb && git log --oneline -5` — and once per checkout `npm run hooks:install` (every
   push then runs the quick gate automatically: secrets, typecheck, lint).
2. `sed -n '1,40p' docs/STATUS.md` → the **Next** section names the card.
3. Is there a **resume note**? `ls docs/pr-cards/*.progress.md 2>/dev/null` — if your card has one, read it and continue
   from its "Next step". Do not restart work that it lists as done.
4. Read your card (`docs/pr-cards/<ID>.md`). Read only what its "Read only these" list says.

## 2. Never do these without Chris (from AGENTS "Hard limits")

Live Stripe payments, live SMS or customer email; buying anything; changing or deleting real customer, billing or
signature data; seeds/resets against production; anything outside this project; committing directly to `main`;
skipping, disabling or weakening tests; re-enabling public sign-up; secrets anywhere in code, docs or logs.

## 3. The work loop

1. Branch `ai/<tool>/<topic>` from latest `main` (or the card's base).
2. Drift check: `docs/implementation-contracts/DRIFT-PROTOCOL.md` **checklist A** (table in the PR, card corrected
   first). Mechanical drift: fix and note it. A real decision missing: stop that card (§6).
3. Build one work unit → its tests → `npm run preflight -- --unit/--db/--browser <the card's tests>` (PLAYBOOK 4b; the
   registry table in 4c lists what else to update) →
   **commit locally** → update the resume note (§4). Repeat. Checks red → the fix-and-retest loop in PLAYBOOK 4b (one
   failing file at a time, then the full check once) — never stop on a red result.
4. **Code first, then docs.** Publishing verified code beats polishing documents: in an implementation PR, edit only the
   docs checklist B names; any other doc cleanup goes in STATUS as a note for later.
5. When the card is complete: update the docs **as if this PR had already merged** (card `MERGED (#n)`, STATUS, living
   docs — DRIFT-PROTOCOL checklist B; CI fails an app PR that skips STATUS/card), push once (the hook runs the quick gate; never `--no-verify`), open
   the PR, then follow PLAYBOOK Steps 5–9. Checklist B is done inside the PR, not after it. Last PR of a batch: **checklist C** (batch close-out) before the next batch. One push per CI cycle; after a red run read every failure, reproduce it
   locally, fix them all, push once.

## 4. Resume note — so stopping never loses your place

Keep `docs/pr-cards/<ID>.progress.md` (≤20 lines) on your branch and update it after every commit:

```
Card: W-0A · Branch: ai/sol/w-0a · Last commit: <sha> <subject>
Done: 1 business address confirm (tests pass) · 2 re-save recalculates
Next step: 3 catch-up — write recalculatePendingPurchaseTax, then its integration test
Blocked: none
```

Delete it in the card's final commit (the PR description carries the summary).

## 5. Anti-stall rules (from AGENTS "Working without stalling" — mandatory)

- Read files over ~300 lines by section only (`grep -n` the heading or name, then `sed -n 'A,Bp'`, ≤150 lines).
- Every search has a path and `| head -50`; never search the repo root, `node_modules`, `.next`.
- Only commands that finish by themselves: `npx vitest run <file>` (never bare `vitest`), never `npm run dev`,
  watch modes, `tail -f` or sleep/poll loops; wrap slow ones in `timeout 600`; `GIT_PAGER=cat`, `CI=1`.
- Pipe long output through `| tail -80`. Same command fails or hangs twice → change approach or record the blocker.
- After ~10 reads/searches without an edit, stop exploring and make the smallest next edit.
- CI, reviews and previews: check once, act on what is new, then do other work. Don't watch.

## 6. Stopping

Stop only for a real gate: a hard limit (§2), a missing money/security/schema decision, or a card over 800 production
lines. Before stopping: commit, update the resume note's "Next step" and "Blocked", update `docs/STATUS.md`, and say in
one plain-English paragraph what is done and what Chris needs to decide.

## Restart message for Chris to paste when a session stops

> Continue the Appliance Desk work. Read `docs/SESSION-START.md`, then your card's resume note
> (`docs/pr-cards/<ID>.progress.md`) if it exists, and pick up at its "Next step". Follow the anti-stall rules.
