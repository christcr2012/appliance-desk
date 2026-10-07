# PR cards — one short, complete instruction file per PR

A card turns an approved design into exactly one PR that a medium-effort model can build without exploring or
deciding anything. Written by a heavy-reasoning model after reading the design **and the current code**. Where a card
and its design differ, **the card wins** (the design keeps the reasons). A PR whose design carries an "Implementation
gate" note may not start until its card is here.

Rules for cards:
- Fits the PR budget (`docs/PLAYBOOK.md` Step 3a): about 500 production lines, about 15 files, at most one migration,
  one risk area. If it does not fit, it is two cards.
- Uses nothing a later PR builds. If it needs something later, that thing moves into this card or this card moves
  later.
- Every name is exact: file paths, function signatures with types, enum values, columns with defaults, routes,
  permissions per role, setting names with starting values, test file names and test case titles.
- Lists the **only** things to read, by heading or `grep -n` pattern, so nobody opens a 2,000-line file.
- Under ~250 lines.

## Template

```markdown
# <PR id> — <short title>

Base branch: <previous PR branch or main> · Risk area: <one> · Migration: <name or "none"> · Budget estimate: <lines/files>
Design: <file> sections <…> (reasons only — this card is the build spec)

## Read only these (in this order)
1. <file> — `grep -n "<pattern>"` then lines around it
2. …

## Before you start (verify; if false, stop and report)
- <assumption> — check with `<command>`

## Build
### Schema (exact Prisma; omit if none)
### Functions (exact signatures, file paths, what each does in 1–3 lines, who may call it)
### Screens / routes (path, who sees it, what it shows; on-screen explanation text for every setting)
### Settings (name, type, starting value, who can change it)

## Tests (write these; names are exact)
- `tests/<file>.test.ts`: "<case title>", …
- Browser (only if a screen changed): `e2e/<file>.spec.ts` "<case>", shard <browser-x>

## Commands (each finishes on its own)
- `npm run typecheck 2>&1 | tail -40`
- `npm run lint 2>&1 | tail -40`
- `npx vitest run <files> 2>&1 | tail -80`

## Stop and ask if
- <specific condition>

## Done when
- [ ] <acceptance item with the test that proves it>
- [ ] `docs/STATUS.md` updated; review threads dispositioned
```
