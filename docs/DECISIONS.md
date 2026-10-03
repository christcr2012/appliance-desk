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
