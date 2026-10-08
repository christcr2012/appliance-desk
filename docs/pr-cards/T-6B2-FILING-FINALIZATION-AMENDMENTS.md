# T-6b2 — file returns and amendments

Base branch: final reviewed T-6b1 · Risk area: filing finalization + amendment integrity · Migration: none · Budget estimate: ~450 production lines / <14 files
Design: `docs/designs/BATCH-T.md` sections 11.4 markPeriodFiled, 11.11 done-step rules, 11.12 amendments (reasons only — this card is the build spec)

## Read only these (in this order)
1. `src/domains/tax/filing-packet.ts` from T-6b1.
2. `src/domains/tax/filing-reminders.ts` from T-6a2 — amendment detector seam only.
3. `src/lib/team-actor.ts`, `src/lib/session.ts` — owner mutation conventions.
4. `src/domains/exceptions/index.ts`, `src/domains/exceptions/rules.ts` — Sales-tax Today conventions.
5. Existing private photo model/helper used for owner-only confirmation screenshots.
6. BATCH-T 11.4 mark-filed paragraph, 11.11 step 5, 11.12 only.

## Before you start
- T-6b1 is merged; packet calculation is the sole filing-total source.
- T-6a2 amendment detector seam exists.
- This PR does not build the T-7 screens.

## Build
Create/extend `src/domains/tax/filing.ts`:
```ts
export async function saveFilingEntryProgress(
  actorUserId: string,
  input: { periodId: string; entryProgress: Record<string, boolean> },
): Promise<void>;

export async function markPeriodFiled(
  actorUserId: string,
  input: {
    periodId: string;
    filedOn: Date;
    paidOn: Date;
    confirmationNumber: string;
    amountPaidCents: number;
    amountDifferentReason?: string;
    confirmationPhotoId?: string | null;
  },
): Promise<void>;

export async function detectTaxFilingAmendments(now?: Date): Promise<number>;

export async function markAmendmentFiled(
  actorUserId: string,
  input: {
    amendmentId: string;
    filedOn: Date;
    paidOn: Date;
    confirmationNumber: string;
    amountPaidCents: number;
    amountDifferentReason?: string;
  },
): Promise<void>;

export async function markAmendmentHandledOutside(
  actorUserId: string,
  input: { amendmentId: string; reason: string },
): Promise<void>;
```

Rules:
- Mutation functions require an active OWNER at the transactional boundary; ADMIN is read-only.
- Row-lock period/amendment before checking state.
- `markPeriodFiled` rebuilds the packet immediately before write, requires READY, freezes that packet in `worksheet`, sets FILED and filing/payment evidence, sets `zeroReturn`, and audits old/new values.
- Expected paid amount = on-time total only when both filedOn and paidOn are on/before `legalDueOn`; otherwise late total. Any different amount requires a non-blank one-line reason stored in notes. Never invent penalties/interest.
- Confirmation number is required. Photo is optional and must reference the existing private store; no public URL.
- Entry-progress writes are convenience only and never alter totals/readiness.
- Amendment detection scans FILED periods for tax/use-tax/payment/refund evidence whose effective period data changed after filedOn; rebuild current packet. If it differs from the latest filed packet, create or refresh exactly one OPEN amendment. Previously reported = original frozen packet or latest FILED amendment packet.
- Amendment packet stores corrected full values plus previouslyReported/difference per row. Never net a correction into the next period.
- Additional tax = corrected − previously reported. No service fee on additional tax.
- `markAmendmentFiled` freezes the OPEN amendment packet and payment evidence; amount mismatch needs reason.
- Negative/zero additional tax may use `markAmendmentHandledOutside`; reason required and audit action records OWNER.
- Wire `detectTaxFilingAmendments` into T-6a2's production detector seam without changing the cron route.
- Extend Today:
  - `TAX_AMENDMENT_DUE` for OPEN amendments, high when more tax owed, clears only FILED/HANDLED_OUTSIDE.
  - `TAX_FILING_NOT_READY` for closed/open or last-five-day periods whose packet is blocked or has total-changing warnings; high inside 7 days of due date.
  OWNER/ADMIN view; actions remain T-7 UI.

## Tests
- ★ `tests/tax-filing-integration.test.ts`: mark filed freezes packet; confirmation required; amount mismatch reason required; on-time vs late expected amount; Owner-only; idempotent/refuses already filed; private photo reference.
- `tests/tax-filing-packet.test.ts`: previously reported/corrected/difference amendment shape; additional tax gets no service fee.
- ★ `tests/tax-filing-amendments-integration.test.ts`: changed filed-period evidence creates one OPEN amendment; repeated detector refreshes not duplicates; latest FILED amendment becomes baseline; mark filed freezes; overpayment handled-outside reason; ADMIN refused.
- `tests/exceptions-tax.test.ts`: amendment/not-ready items, severity/order/disappearance.
- `tests/tax-filing-reminders-integration.test.ts`: scheduler invokes detector and isolates detector failure.

## Commands
- `npm run typecheck 2>&1 | tail -40`
- `npm run lint 2>&1 | tail -40`
- `npx vitest run tests/tax-filing-integration.test.ts tests/tax-filing-packet.test.ts tests/tax-filing-amendments-integration.test.ts tests/exceptions-tax.test.ts tests/tax-filing-reminders-integration.test.ts 2>&1 | tail -120`

## Stop and ask if
- Marking filed would require changing historical invoice/tax evidence.
- A correction cannot be assigned unambiguously to its original filed period.
- SUTS requires netting a correction into a later return.

## Done when
- [ ] original filed packet is immutable evidence
- [ ] amendments are one-open-per-period and use full corrected values
- [ ] OWNER-only filing/handled-outside decisions are audited
- [ ] amount differences never silently overwrite expected totals
- [ ] scheduler detects amendments without a second cron
- [ ] `docs/STATUS.md` updated; review threads dispositioned
