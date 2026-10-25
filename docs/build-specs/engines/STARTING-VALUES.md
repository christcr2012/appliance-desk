# Build spec — Researched starting values (DEC-2)

Card: `docs/pr-cards/DEC-2.md`. Depends on **DEC-1a** (registry, `DecisionRecord`, provisional tax values). The values
and their sources are in `docs/research/2026-10-25-open-decisions.md` — that file is the only place values live;
this spec says how they get into the registry and the live app. Approved by Chris 2026-10-25: researched starting
values are applied to the live app, marked "Starting value — not confirmed", changeable, never touching signed or
billed history. Read `docs/AI-PR-READ-FIRST.md` (money, tax and settings writes).

## 1. Fill the registry (`src/domains/decisions/registry.ts`)
- For every row of the research file, set the subject's `recommended = { value, why, sources }`. `why` is the "Why"
  column rewritten as one or two plain sentences for Chris (no statute numbers in `why`; they go in `sources`).
  `sources` are the rows' URLs with `checkedOn: "2026-10-25"`.
- Subjects the research file splits finer than DEC-1a did (e.g. one per charge category × State/Greeley) are added
  with ids `IN-34-{CATEGORY}-{STATE|GREELEY}` (category in the `TaxCategory` spelling, e.g. `IN-34-DELIVERY-GREELEY`).
- Add `GREELEY-RATE-2F` (audience OWNER, area TAX): question "Did Greeley's ballot measure 2F pass, changing the city
  rate?"; options "No change (4.11%)", "Passed — enter the new rate"; `read` = the Greeley jurisdiction's current
  rate; `write` = the existing rate-table save function with an effective date (never the past).
- Owner-answered subjects (IN-84, IN-06, IN-76, IN-52, IN-78, IN-83): `recommended` = Chris's answer with
  `sources: [{ title: "Chris's answer (OWNER-INPUTS)", url: "docs/OWNER-INPUTS.md#in-xx", checkedOn: "2026-10-13" }]`.
  They are applied as `CONFIRMED` (section 3), not as starting values, because Chris already answered them.
- Each subject also gets `liveUse: "YES" | "ESTIMATE_ONLY"` from the research file's "Runs live?" column.
  `ESTIMATE_ONLY` (IN-39-DEPR tax class, IN-56 tax gain) means screens show the figure with "Estimate — your CPA
  confirms" and nothing is filed or posted from it.

## 2. Late-fee gaps found while specifying (fix in this PR — they make IN-84 real)
1. **New agreements ignore the setting.** `createAgreementDraft`/`createAgreement` (`src/domains/agreements/index.ts`
   ~228 and ~273) default the grace period to a literal `5` and the fee to `0`, and the rental wizard
   (`src/app/desk/agreements/new/rental-wizard.tsx` ~46) starts with an empty fee. Change all three to read
   `getBusinessSettings()` (`lateFeeGraceDays`, `lateFeeFlatCents`, `lateFeePercent`) when the input leaves them out;
   the wizard pre-fills the dollar box from the setting. Renewals keep copying the old agreement's terms
   (`renewal-data.ts`), unchanged. Quote-to-rental conversion uses the setting too (find the caller with
   `grep -n "createAgreement" src/domains/estimates`).
2. **No way to waive a late fee.** IN-84 says the owner (or admin doing money) may waive one with a reason. Add
   `waiveLateFee(actorId, invoiceId, reason)` in `src/domains/billing/late-fees.ts`, OWNER/ADMIN:
   one transaction; `SELECT … FROM "Invoice" WHERE id = $1 FOR UPDATE`; `assertActiveTeamActor(tx, actorId,
   ["OWNER","ADMIN"])`; re-read the locked row and refuse unless the invoice is open, `lateFeeCents > 0` ("There's no late fee on this bill") **and `lateFeeWaivedAt` is null** ("This late fee was already waived" — so two waivers at once, or a retry, subtract it only once);
   reason 3–500 characters; add a negative invoice line "Late fee waived — {reason}" of `-lateFeeCents`, reduce
   `amountDueCents` by the same amount through the existing invoice-total function (never edit the original fee line),
   keep `lateFeeCents` as the record of what was charged and set the new field `lateFeeWaivedAt` (additive, nullable)
   so `applyLateFees` never adds it again (its existing `lateFeeCents !== 0` skip already covers this; keep both); audit `invoice.late_fee_waived` with amount and reason. If the invoice has
   an open Stripe payment page, use the same refresh path that partial payments use so the page shows the new amount
   (test mode only; live payments stay off).
   Bill record screen (MONEY-AREA spec): ⋯ menu item "Waive late fee…" (OWNER/ADMIN, only when a fee exists and is not
   waived) → `ConfirmDialog` with a required reason box: "Waive the {amount} late fee on bill #{n}? The customer's
   balance goes down by {amount}."
3. `applyLateFees` already charges once per bill after the grace days (`todayKey < due + grace` skips), which gives
   "fee on day 6" for a 5-day grace. Add a test that pins it: due Oct 1 → no fee Oct 5, fee Oct 6 (Denver dates,
   including the DST change on Nov 1).

## 3. Applying the values to the live app (`src/domains/decisions/starting-values.ts`)
```ts
export async function applyStartingValues(now = new Date()): Promise<{ applied: string[]; confirmed: string[]; skipped: { id: string; why: string }[] }>
```
- Runs from the existing nightly `/api/cron/books-nightly` route (same cron secret check) **after** its current work;
  no new cron entry (cost rule). It is idempotent: it does nothing for a subject that already has any
  `DecisionRecord`.
- Actor: the active OWNER user (one query; if there is not exactly one active OWNER, skip everything and log
  `starting_values.no_single_owner`). Each subject's `write` runs with that id, so the existing save functions' locks,
  actor checks and settings-history rows apply. The `DecisionRecord` has `answeredByUserId = null`, `via =
  "MIGRATION"`, `explanation = "Starting value approved by Chris on 2026-10-25"`.
- For each subject with `recommended !== null`, inside one transaction per subject:
  1. Lock the settings row (as DEC-1 section 4) and re-read the current value.
  2. Apply only if the current value is the code's untouched default (`UNDECIDED`, or for non-enum settings the
     schema default listed in the subject as `untouchedDefault`, e.g. `lateFeeFlatCents: 0`). If Chris has set
     anything else, record nothing and add `{ id, why: "Already set by you" }` to `skipped` — never overwrite.
  3. Write with `effectiveFrom` = the next Denver business date (never today's already-billed work, never the
     past), through DEC-1's scheduled-change path (DEC-1 section 4a): tax cells take effect exactly at the start of that
     date through the date-aware read; other settings apply in the first nightly run on that date. Tax rules use the
     provisional path (DEC-1 section 5) so they carry `provisional = true`.
  4. Record `STARTING_VALUE_APPLIED` (researched subjects) or `CONFIRMED` (owner-answered subjects) with
     `previousValue`, `value`, `sources`.
- Nothing already signed or billed changes: agreements keep their snapshot terms; issued invoices keep their tax
  lines; the tax engine reads taxability through `getTaxabilityRulesAsOf(date)` (DEC-1 section 4a).
- **To do item.** To do items are computed, not stored (`src/domains/exceptions/rules.ts` + `index.ts`). Add
  category `DECISIONS_STARTING_VALUES` (severity `medium`) and a pure rule
  `startingValuesAppliedException({ count, newest })`: title "{count} starting values are now in use", detail
  "Researched answers for tax and rental questions. Review them, or send the tax ones to your CPA.", href
  `/desk/settings/decisions?state=starting`, primary action "Review", `since = newest`. `index.ts` counts
  `DecisionRecord` rows with `kind = STARTING_VALUE_APPLIED` and `via = MIGRATION` created after the new nullable
  field `BusinessSettings.decisionsReviewedAt` (additive migration, with `Invoice.lateFeeWaivedAt` in one migration
  `20261027010000_starting_values`); the item shows when that count is > 0. Opening `/desk/settings/decisions` as
  the OWNER sets `decisionsReviewedAt = now` (server action on page load is not allowed — use a small "Mark as
  reviewed" button at the top of the page that the To do also mentions, plus setting it on any confirm/change). Add
  `DECISIONS_STARTING_VALUES: "Review"` to `ACTION_LABEL` in `todo.ts`.

## 4. What Chris sees change (put this text in the PR body)
- New rentals show a $5 late fee after a 5-day grace period on the signing page (existing wording). Existing
  rentals keep what they signed.
- Bills start showing state tax as $0 on rent (paid when the appliance was bought) and Greeley city tax on rent and
  fees — the careful choice until the CPA or the city answers.
- Delivery, installation, removal, setup, damage-waiver and early-ending charges show state tax (careful choice).
- Tax filing screens show "Starting value — not confirmed by your CPA" next to those lines.
- Settings › Decisions & reviews lists every starting value with why and sources, and the CPA form contains the
  questions from the research file's "CPA question" notes.

## 5. Tests
- `tests/decisions-registry.test.ts` (extend): every subject has `recommended` or an explicit `NO_SOURCE` reason;
  every recommended value passes the setting's own validator; every source has `https://` or a `docs/` path and
  `checkedOn`.
- `tests/starting-values-integration.test.ts` (throwaway Postgres): fresh install → all applied, records written,
  the To do item (until Mark as reviewed); second run → nothing; a setting Chris changed → skipped and untouched; a signed agreement and an issued
  invoice from before → unchanged (compare rows); provisional tax rules calculate and carry `provisional`; more than
  one OWNER → nothing applied.
- `tests/late-fee-defaults.test.ts`: new draft without a fee gets the setting; renewal keeps old terms; wizard
  pre-fill.
- `tests/late-fee-waiver-integration.test.ts`: waive → negative line, balance down, `applyLateFees` does not
  re-add; staff refused; no fee → refused; concurrent waive → one wins.
- `tests/late-fee-day6.test.ts`: the day-6 and DST cases above.
- `e2e/late-fee-waiver.spec.ts` (add to a shard in `e2e/shards.json`): owner waives from the bill record; axe.
