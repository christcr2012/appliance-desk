# Decisions log — current

This is the **current** decisions log. Keep it short and useful: dated entries,
newest first, for decisions made from 2026-10-03 forward.

The original decisions log was retired because it had grown too large to serve
as routine working context. Its archive entry follows the same retirement
convention as the other retired project documents:

`docs/archive/DECISIONS-before-2026-10-03.md`

That retired index points to the unchanged historical log. Do **not** read the
historical log end to end during normal work. Search it only when a specific
older decision, date, feature, PR, or code comment requires the historical
reasoning. If an older code comment says “see docs/DECISIONS.md” and cites a
date before 2026-10-03, use the retired archive entry above.

If a current decision is later reversed, add a new dated entry here rather than
editing the earlier decision away.

---

### 2026-10-03 (later) — One stack per batch, clustered PRs, CI budget lifted, owner-configurable by default

Chris replaced the earlier PR-size rules: each batch is one stack of
reasonably sized, coherent PRs (not single-item PRs, not one giant PR); CI
time/cost is no longer a constraint; agents should use the web for current
practice; and anything a business might change must be an owner-editable
setting. Model switches are never done by the agent: it hands Chris a prompt
for a separate chat instead. `gh stack` could not be installed in the agent
sandbox (403 on the extension download), so stacks are chained by hand there.
Reason: fewer, better-checked PRs with real review, and a system Chris can
run himself. Recorded in `AGENTS.md`.

### 2026-10-03 — Stacked PRs and smaller chunks, instead of one PR per batch

Chris asked (2026-10-03) for manageable chunks of work rather than one large PR
per batch, while keeping CI cost down, and for each PR to be built on top of the
previous one so work does not wait on merges. This supersedes the "one
substantial PR per batch" rule in `AGENTS.md` for Batch B onward. Cost control
stays: verify locally and push once per PR, docs-only PRs skip CI, and the
5-minute CI budget is unchanged. A stacked branch is created from its
predecessor and retargeted to `main` when the predecessor merges.

### 2026-10-03 — Tax rate precision: milli-percent helpers first, storage move later

Owner decision IN-17 requires rates exact to 0.001 percentage point (7.375%).
`docs/designs/BATCH-B.md` D12 predates it and kept tenths of a percent. The new
helpers in `src/domains/billing/tax.ts` use thousandths of a percent and convert
the existing tenths values exactly. Moving the stored rate (an additive
migration, the settings screen, the agreement snapshot and Stripe tax-rate
creation) is a separate, later chunk because it touches money display and
Stripe; nothing is half-migrated in the meantime.

### 2026-10-03 — Local testing: cheap checks only; CI runs the full suite

CI on the public repo is free and finishes in about 3 minutes, while setting up
a throwaway Postgres and running the whole suite locally costs the agent far
more effort than one CI round trip. Chris left the choice to the agent (he pays
for agent usage). Decision: run typecheck, lint and the tests touching the
change before each push; rely on CI for the full unit suite and browser specs;
go local only for migrations/SQL, unexplained failures, or a spec being
iterated on. On a CI failure, read the full job logs, fix everything, push
once. Revisit if CI failures after pushing become frequent.

### 2026-10-03 — Tax rate storage moved to thousandths of a percent (completes IN-17)

Added `taxRateMilliPercent` to `BusinessSettings` and `RentalAgreement` (additive
migration; existing values multiplied by 100, proven on a scratch database:
73 became 7300). The old `taxRatePermille` columns stay, unused, so nothing is
dropped; a later cleanup migration may remove them. Settings, the rental
builder, the public pricing page and Stripe tax-rate creation use the exact
value; new agreements start with the owner's rate once it is CPA-confirmed.
Stripe's rate list is read page by page so an existing rate is reused rather
than duplicated.

### 2026-10-03 — Fixed terms start at delivery; policy values are entered in the app

Chris answered IN-20: a 6- or 12-month term starts at delivery (when billing
starts). Before this, nothing set `RentalAgreement.endDate` for a fixed term, so
the Stripe `cancel_at` from WU-B4 never took effect. `startRecurringBillingForAgreement`
now saves the end date under its row lock the first time billing is attempted
after delivery and never overwrites it, so a retry sends Stripe the same stop
date. Chris also answered IN-19's "where do these values live": they are entered
by the owner in Settings → Ending and renewing rentals (no values in code), with
blank meaning "not decided yet". The auto-renew terms version is generated from
the wording and notice days rather than typed, so a wording change cannot
silently reuse an old version. The values themselves are still for Chris to enter.

### 2026-10-03 — Retire the first decisions log and start a fresh current log

Chris requested that the oversized original `docs/DECISIONS.md` stop being part
of routine working context. It is retired using the same archive convention as
the other historical working documents: a top-level **RETIRED DOCUMENT —
reference only** warning at `docs/archive/DECISIONS-before-2026-10-03.md`, with
the complete original history preserved unchanged behind that index.

Going forward, new decisions are recorded here. Historical context is pulled
from the archive only when a concrete question requires it.

### 2026-10-03 — Code-review fixes ride the next planned PR

Chris decided that review comments are fixed inside the next planned PR rather
than in their own PRs or extra pushes, because every push costs a CI run. Each
finding still gets a recorded disposition and a regression test. Only a
security or money-correctness hole already on `main` is fixed immediately.

### 2026-10-03 — Agreements keep their own terms; policy changes need 30 days' notice

Chris decided: fixed-term leases are locked to the ending/renewal terms they
signed; changing the system-wide terms must not affect them. Month-to-month
agreements follow the system-wide terms, effective 30 days after the change,
with every customer told in writing (current leases unaffected, month-to-month
affected). Terms can also be customized per customer at sign-up/setup/estimate.
Consequence: early-ending quotes read the agreement's saved terms, not the live
settings. Sending the notice is live customer email and needs Chris's approval
before it is turned on.

### 2026-10-03 — CI is built to cost minutes, not to be fast

GitHub Actions minutes ran out on day 3 of the month: ~190 runs since Oct 1
(43 cancelled mid-run, still billed) at ~22 billed minutes per full run (five
working jobs, three of them repeating install + build for the browser tests).
Chris asked for a drastic efficiency improvement. Changes: CI runs when a PR is
opened or marked ready, not on every push (re-run by hand once after local
verification); draft PRs run nothing; type-check, lint and the unit suite share
one job; the browser suite runs on one runner, only when the change can affect
a browser, and nightly on `main`; a push to `main` runs the cheap checks only;
the failure-only Playwright report is kept 3 days. This supersedes the
2026-10-02 "5-minute wall-clock" goal, which was achieved by spending more
minutes. Accepted trade-off: a logic-only change that breaks a screen is caught
by the nightly run, not before merge. Not done: making the repo public (free
Actions, but exposes the code).

### 2026-10-03 — Repository made public; CI rebuilt for speed and secret scanning

Chris made the repository public (the code is a customized version of existing
things, nothing in it needs to be private), which makes standard Actions minutes
free. This supersedes the cost-saving CI of the same day: CI now runs on every
push, all checks in parallel (secret scan, type-check + lint, unit tests in 3
shards, browser tests in 4 shards), with `permissions: contents: read` and no
secrets. Quality is unchanged or better: same checks, plus `scripts/check-secrets.mjs`
and gitleaks over the whole git history on every run, including docs-only
changes. Real production Neon/Vercel identifiers found in old docs and one test
were replaced with placeholders; they remain in git history (identifiers only, no
passwords or keys), so Chris was advised to optionally rotate the production
database password. The 1-to-2-minute target was not promised for browser tests:
a production build plus browser install is a fixed cost of about two minutes per
runner. Chris must enable GitHub secret scanning/push protection and the fork
pull-request approval setting himself (agents cannot reach those settings).

