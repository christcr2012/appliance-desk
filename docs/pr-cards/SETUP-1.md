# SETUP-1 — Set up your business (guided walkthroughs)

Build spec: `docs/build-specs/engines/RECORDS-VAULT.md` sections 8–9. Requested by Chris 2026-10-25. Depends on VAULT-1.

## Acceptance
- [x] Every walkthrough in the spec, each with steps, links (https), the record it fills and automatic checks where possible.
- [x] Progress per walkthrough; next suggested by what it unlocks soonest; Today card until done or "Not for me".
- [x] Owner checklist rows link to their walkthrough instead of repeating steps.
- [x] Checks never reveal secret values (presence only); `ci` green; every review comment read.

## Execution packet (2026-10-27, base `9f7671dd` — VAULT-1 merged)

Registered as `docs/pr-cards/execution/SETUP-1.json`. Branch `ai/vivienne/setup-1`.
Scope: `src/domains/setup/walkthroughs.ts` (pure data + suggestion ordering) and
`src/domains/setup/guide.ts` (progress + checks + writes), screens at
`/desk/setup-guide` and `/desk/setup-guide/[key]` (OWNER), one `SETUP_GUIDE`
To do from `src/domains/exceptions/setup-attention.ts`, a More-menu owner entry,
and OWNER-CHECKLIST link updates. **No migration** (per the card plan).

### Drift check (spec vs the repo as it stands at `9f7671dd`)

| # | Spec says | Repo reality | Resolution in this build |
|---|---|---|---|
| 1 | A guided setup screen at `/desk/setup-guide` | W-7 already built a "Get set up" Today card (`src/domains/setup/checklist.ts`): six app-configuration steps (business, service area, prices, tax, payments, email) derived from saved state | Different job: W-7 configures the app; SETUP-1 walks the real-world accounts (LLC, EIN, bank, licenses, portals) and fills VAULT-1 records. Both stay; SETUP-1 lives beside it in `src/domains/setup/` and never duplicates a W-7 step |
| 2 | Progress per walkthrough | The card plan says migration "none"; OPS-8's check-up used a dedicated model | Progress and "Not for me" are **audit rows** (`SetupGuide` entity: `setup.step_done`, `setup.step_reopened`, `setup.dismissed`, `setup.restored`) folded into current state on read — no schema change, and the history is the record of who did what |
| 3 | Checks: `ENV_PRESENT`, `STRIPE_CONNECTED`, `RECORD_HAS_NUMBER`, `RECORD_HAS_FILE`, `TAX_ACCOUNT_SET`, `WEBHOOK_SEEN`, `EMAIL_SENDS_OK`, "etc." | `WEBHOOK_SEEN` and `EMAIL_SENDS_OK` have no stored signal today; Stripe here is env keys, not an account link | Implemented set, each with a real source: `ENV_PRESENT` (allowlisted names, presence only), `RECORD_EXISTS` / `RECORD_HAS_NUMBER` / `RECORD_HAS_FILE` (by `templateKey`), `FILING_ACCOUNT_SET` (an active `TaxFilingAccount` of the kind). The data test fails on any referenced check that is not implemented |
| 4 | Next suggested "by what it unlocks soonest — e.g. IRIS TCC before Jan 31" | No deadline data exists | Walkthroughs carry an optional `neededBy` (month-day + label). Suggestion order: an incomplete, not-dismissed walkthrough whose needed-by date falls within 120 days (soonest first), then data order |
| 5 | "I did this … asks for the number/file the step produces and saves it into the business record/vault in the same flow" | The record may not exist yet (starters are added from the Records screen) | The step flow ensures the one starter record exists (same row mapping as `addStarterChecklist`, refactored into a shared helper), then saves through VAULT-1's `updatePaperwork` number path / `attachRecordFile` — no record writes in the setup domain |

### Named regression cases
- Data: every link https; every `record.templateKey` in `PAPERWORK_TEMPLATES`; every check in the implemented registry; unique walkthrough/step keys; suggestion ordering (deadline beats data order; dismissed and complete never suggested).
- Integration (throwaway Postgres): ADMIN/STAFF/CUSTOMER get not-found from every guide read/write; progress folds correctly through done → reopened → done and dismiss → restore; a check that passes marks its step done even with no manual mark; a manual mark never beats a failing check's truth about numbers/keys (step shows done-by-you, check shown separately); saving a number through a step lands encrypted on the record with last-4 only in the DTO; the To do names the suggested walkthrough and clears when all are done or dismissed.

## Progress
MERGED 2026-10-27 via PR #661, squash commit 39d4bf8e on main (final head 716515bb; CI fully green at the exact head — secret scan, typecheck/lint, all three unit shards, all five browser shards; both Codex threads replied to and resolved before merging).

Review round on PR #661 (2026-10-27): CI's unit shards caught a real miss — the new /desk/setup-guide address was not in the ACC-5 job-role screen registry (fixed: it belongs to the management screen, owner-only like continuity/insurance). Codex raised two findings, both real, both fixed with regression tests: (1) RECORD_EXISTS checked steps for records that merely exist — and the starter checklist creates every record empty, so adding starters silently "finished" account/policy steps; the check now requires the record itself to have been marked done (its lastDoneOn), and describeCheck says so. (2) The backups step checked the PUBLIC photo token (BLOB_READ_WRITE_TOKEN); record files use the private store, so the step now checks PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN + PRIVATE_PHOTO_BLOB_STORE_ID via a new ENV_ALL_PRESENT check (all named settings present, values never read beyond presence).

Packet and drift check written 2026-10-27 (this commit also lands the VAULT-1 merged close-out in this card file set: VAULT-1 card acceptance + work-index). Built the same day: `src/domains/setup/walkthroughs.ts` (15 walkthroughs, pure data + suggestion order) and `guide.ts` (audit-folded progress, presence/record/filing-account checks, step saves through the VAULT-1 domain), screens at `/desk/setup-guide` + `/[key]`, the `SETUP_GUIDE` To do, the More-menu entry, checklist links, OWNER-GUIDE section. Local proof on the merged (CMP-2) tree: 130 tests across the setup, records, paperwork, exceptions, menu and guide suites; typecheck and lint clean; migration and shard checks clean; the range secret scan clean. The local browser launcher's build step exceeds its 600-second cap in this VM (three attempts, including one warm), so the browser spec's local run is replaced by the checks phase plus PR CI as the browser gate — stated in the PR.
