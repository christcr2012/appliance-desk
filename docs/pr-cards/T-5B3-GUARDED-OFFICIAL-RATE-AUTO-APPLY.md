# T-5b3 — guarded official rate observation and auto-apply

Base branch: ai/chatgpt/t5b2-official-source-watch · Risk area: tax-rate money correctness / provider synchronization · Migration: none · Budget estimate: ~500 production lines / 13 files
Design: `docs/designs/BATCH-T.md` sections 13.2, 13.4–13.6 plus D-T9 rate-change processing (reasons only — this card is the build spec)

## Read only these (in this order)
1. `src/domains/tax/colorado-gis.ts` — current automatic-provider seam and authenticated-contract gate
2. `src/domains/tax/official-rate-metadata.ts` — observation/two-day confirmation helpers from T-5b1
3. `src/domains/tax/rate-changes.ts` — `rateStartsTomorrow`, `subscriptionTaxUpdateKey`, `syncSubscriptionTaxRatesForAgreement`, `retrySubscriptionTaxUpdate`, `applyTaxRateChanges`, and `TAX_RATE_CHANGES_RULE_KEY`
4. `src/domains/billing/provider-ops.ts` — only `SUBSCRIPTION_TAX_UPDATE` claim/retry/supersede semantics used by `rate-changes.ts`
5. `src/domains/tax/address-recheck.ts` — current December/June or tax cron scheduling helpers
6. `src/domains/tax/engine.ts` and the current-rate query it calls — only the code that selects `TaxRateVersion`
7. `src/domains/exceptions/index.ts` — Sales-tax Today item conventions
8. `src/domains/audit/` — `grep -rn "audit" src/domains/audit src/domains/tax | head -30`; open only the existing helper used by Batch T
9. `docs/designs/BATCH-T.md` — only 13.2, 13.4–13.6 and the D-T9 paragraph

## Before you start (verify; if false, stop and report)
- T-5b1 and T-5b2 are merged.
- #297/T-5a4 durable `SUBSCRIPTION_TAX_UPDATE` operations are merged; there is exactly one Stripe subscription tax-rate update path.
- `TaxRateVersion` has `autoApplied` and `autoAppliedUndoneAt`; `BusinessSettings` has `autoApplyOfficialRateChanges` and `autoRateChangeMaxMilliPercent`.
- The Colorado GIS provider contract either exposes an authenticated effective-date lookup or explicitly reports that capability unavailable. Do not invent an endpoint or response contract.
- No live Stripe/customer-email activation is required; existing provider/test-mode gates remain unchanged.

## Build

### Effective-date observation seam
Extend the existing Colorado GIS abstraction; do not add a second provider client.

Add these exported types in `src/domains/tax/colorado-gis.ts`:

```ts
export type ColoradoEffectiveRateObservation = {
  jurisdictionCode: string;
  jurisdictionLevel: TaxJurisdictionLevel;
  effectiveFrom: Date;
  rateMilliPercent: number;
};

export type ColoradoEffectiveRateLookup =
  | { status: "SUPPORTED"; observations: ColoradoEffectiveRateObservation[] }
  | { status: "UNAVAILABLE"; reason: string }
  | { status: "UNSUPPORTED" };
```

Add an optional/equivalent provider operation:

```ts
lookupEffectiveRates?(
  input: { asOf: Date; lookAheadThrough: Date },
): Promise<ColoradoEffectiveRateLookup>;
```

Rules:
- Run look-ahead only in June and December by `America/Denver` calendar month.
- If the authenticated provider does not expose this capability, return `UNSUPPORTED` and do nothing else; this is not an error.
- `UNAVAILABLE` preserves existing verified data and creates the existing tax-provider review signal only if current conventions already do so.
- Never infer an effective date or scrape a watched page for a numeric rate.

### Candidate matching and observation
Create `src/domains/tax/official-rate-auto-apply.ts`.

Export:

```ts
export type OfficialRateCandidate = {
  jurisdictionId: string;
  jurisdictionCode: string;
  jurisdictionLevel: TaxJurisdictionLevel;
  effectiveFrom: Date;
  rateMilliPercent: number;
};

export type OfficialRateDecision =
  | { status: "OBSERVED"; observationId: string; confirmed: false }
  | { status: "AUTO_APPLIED"; observationId: string; rateVersionId: string }
  | { status: "REVIEW_REQUIRED"; observationId: string; reasons: string[] }
  | { status: "IGNORED"; reason: string };

export async function processOfficialRateCandidate(
  candidate: OfficialRateCandidate,
  now?: Date,
): Promise<OfficialRateDecision[]>;

export async function undoAutoAppliedRateVersion(
  input: { rateVersionId: string; actorUserId: string; now?: Date },
): Promise<void>;

export async function manuallyApplyObservedRate(
  input: { observationId: string; actorUserId: string; now?: Date },
): Promise<{ rateVersionId: string }>;
```

Transaction/locking rules:
- Resolve the existing jurisdiction by exact code **and** level; no fuzzy/name match.
- Lock that jurisdiction/current relevant rate rows before the final guardrail decision so two cron attempts cannot create duplicate versions.
- Record the candidate through `recordTaxRateObservationInTx`.
- Same-day repeats remain one proof day; confirmation requires the same jurisdiction/effective date/rate on two distinct Denver calendar dates.
- Existing jurisdiction must be `REVIEWED`.
- Candidate effective date must be the current Denver date or later. Never backdate.
- Compare against the currently applicable non-undone rate version immediately before `effectiveFrom`.
- Rate delta must be <= `BusinessSettings.autoRateChangeMaxMilliPercent`; starting value 1000 means 1.000 percentage point.
- `BusinessSettings.autoApplyOfficialRateChanges` must be true.
- Automatic application occurs only when **all** guardrails pass. Create exactly one `TaxRateVersion` with `source = COLORADO_GIS`, `autoApplied = true`, `autoAppliedUndoneAt = null`, the observed rate/effective date, and no guessed provider ID.
- Re-running the same confirmed candidate must find/reuse the same version and must not create another.
- If confirmation is not yet two Denver dates, return `OBSERVED` and create no review task.
- If two-day confirmation exists but any remaining guardrail fails, return `REVIEW_REQUIRED` with stable reason codes; never auto-apply.

### Current-rate selection and undo
- Any tax-engine/current-rate query must ignore a `TaxRateVersion` whose `autoAppliedUndoneAt` is non-null.
- `undoAutoAppliedRateVersion` is OWNER-only at its server-action boundary.
- Undo is allowed only for `autoApplied = true`, not previously undone, and strictly before the Denver calendar day immediately preceding `effectiveFrom`. Once the day-before window begins, reject it.
- Undo sets `autoAppliedUndoneAt`; it does not delete the version or its observations.
- Undo must create durable audit evidence including old/new candidate rate, effective date, actor, and reason `OWNER_UNDO`.
- After undo, any pending provider work for that version must become harmless/superseded through the existing reconciliation path; do not directly delete provider-operation evidence.

### Manual apply
- `manuallyApplyObservedRate` is OWNER-only at its server-action boundary.
- The observation must still correspond to an existing same-code/same-level jurisdiction and an effective date of today or later.
- It may override the switch/guardrail limit but may not override: jurisdiction identity mismatch, past effective date, invalid rate, or duplicate same-rate/same-date version.
- Create `TaxRateVersion.source = COLORADO_GIS`, `autoApplied = false`.
- Audit with reason `OWNER_MANUAL_APPLY` and the guardrail reasons that caused review.
- It must use the same D-T9 subscription synchronization described below; no direct Stripe call.

### D-T9 durable subscription update extension
Modify `src/domains/tax/rate-changes.ts` only at the existing scheduler/selector boundary:
- replace the `rateStartsTomorrow`-only discovery boundary so eligible versions are those starting tomorrow **or already started and not yet successfully pushed/reconciled**; do not create a second scheduler;
- keep `syncSubscriptionTaxRatesForAgreement` and `retrySubscriptionTaxUpdate` as the only provider send/reconciliation path;
- ignore undone auto-applied versions;
- reuse `subscriptionTaxUpdateKey`, `SUBSCRIPTION_TAX_UPDATE` operations, provider-state read-before-retry, and `syncSubscriptionTaxRatesForAgreement`;
- never update subscription prices and never add Stripe automatic tax;
- a rate version that became effective while the provider was unavailable must still be pushed once durable reconciliation can prove/send it.

### Today items and owner actions
Extend the Sales-tax Today feed:
- confirmed candidate + all auto guardrails passed: informational item “Official tax rate scheduled” with jurisdiction, old rate, new rate, effective date and source. It stays until effective date or undo. Expose OWNER Undo only while the domain rule above allows it.
- confirmed candidate + switch OFF or any auto guardrail failure: high-priority item “Official rate needs review” with exact failed guardrails and OWNER action “Apply this rate”.
- items must reference observation/rate-version IDs, not copied customer/address PII.
- OWNER actions call the domain functions above and write audit evidence. ADMIN/STAFF may view only if current Sales-tax feed permissions allow; they may not apply/undo.
- Switch, limit, history, and Official-source settings screens are T-7; do not build them here.

### Audit
Record durable audit events for:
- `OFFICIAL_RATE_AUTO_APPLIED`
- `OFFICIAL_RATE_AUTO_APPLY_REJECTED`
- `OFFICIAL_RATE_MANUAL_APPLIED`
- `OFFICIAL_RATE_AUTO_APPLY_UNDONE`

Include jurisdiction ID/code/level, old/new rate, effective date, observation ID, rate-version ID when present, guardrail reasons, actor when present, and timestamp. Never include customer addresses.

## Tests
- `tests/tax-official-rate-auto-apply-integration.test.ts`:
  - "records the first candidate day without applying"
  - "auto applies only after the same candidate is seen on two Colorado dates"
  - "requires reviewed jurisdiction same code and same level"
  - "rejects a rate delta above the configurable guardrail"
  - "switch off creates review required instead of auto applying"
  - "never backdates an official candidate"
  - "repeated confirmed processing is idempotent"
  - "manual owner apply can override switch or delta guardrail but not identity or past date"
  - "undo is owner only and allowed only before the day-before effective-date window"
  - "undone auto rate is ignored by current-rate selection"
  - "apply manual apply and undo all write audit evidence"
- `tests/tax-rate-changes-integration.test.ts`:
  - "pushes a rate starting tomorrow through SUBSCRIPTION_TAX_UPDATE"
  - "recovers a rate already started but not yet pushed"
  - "ignores an undone auto-applied rate version"
  - retain #297 ambiguous-provider/idempotency coverage unchanged
- `tests/tax-official-rate-today.test.ts`:
  - "successful auto change is informational with owner undo only inside the allowed window"
  - "failed guardrail is high priority with owner apply action"
- Effective-date provider seam coverage in the existing Colorado GIS test file:
  - "unsupported effective-date lookup is a no-op"
  - "unavailable lookup preserves existing verified evidence"
  - "June and December are the only look-ahead months"

## Commands
- `npm run typecheck 2>&1 | tail -40`
- `npm run lint 2>&1 | tail -40`
- `npx vitest run tests/tax-official-rate-auto-apply-integration.test.ts tests/tax-rate-changes-integration.test.ts tests/tax-official-rate-today.test.ts 2>&1 | tail -80`
- run the existing Colorado GIS test file named by the implementation diff

## Stop and ask if
- The authenticated Colorado GIS contract does not document an effective-date lookup and implementation would require guessing an endpoint/field.
- A requested path would create a second Stripe subscription-tax updater or bypass `SUBSCRIPTION_TAX_UPDATE` evidence.
- Any candidate is in the past or cannot be matched exactly to one reviewed jurisdiction code + level.
- Undo would require deleting historical tax/rate/provider evidence.
- A change would activate live Stripe, customer email, or another hard-limit item.

## Done when
- [ ] two distinct Denver observation days are required before any automatic application
- [ ] every guardrail is enforced transactionally and proven on real Postgres
- [ ] auto/manual apply create versioned `COLORADO_GIS` rates without a second provider path
- [ ] D-T9 catches tomorrow and already-effective/unpushed versions using #297 durable operations
- [ ] undo is bounded to before the day-before window and preserves history
- [ ] informational/review Today items expose only the allowed OWNER actions
- [ ] all apply/reject/manual/undo decisions are audited
- [ ] no T-7 settings/history/source screen is built
- [ ] `docs/STATUS.md` updated; review threads dispositioned
