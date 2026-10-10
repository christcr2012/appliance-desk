# COM-L10 — Exact decimal telecom cost evidence and cursor schema

**Status: IN PROGRESS.** Baseline: main `465e458` after COM-L9 #375, with MKT-1/MKT-2 #371–#374 already merged and pricing hidden in production.
Authority: `docs/designs/BATCH-COM.md` §2.3, §6.1–6.2 and §9; one additive migration `com_telecom_cost_evidence`. IN-51/52 remain outside gates; no provider/API calls, activation or spending.

## A — Verify actual contracts and limit scope
- `TelecomAccount`, `BusinessPhoneNumber`, `MessageAttempt`, `CallLeg` already enforce business account/call identities; `ProviderEvent` remains append/replay. Do not replace them.
- L9 privately handles voicemail media, retains `CallSession` IDs and separately gated, default-off recording. Costs are **not** recording availability or conversation permissions.
- `BACKUP_MODEL_POLICY` is exhaustive, so all five new models must be explicit business recovery entries; private statement evidence bytes remain in the independent private blob system, never in snapshots.
- K posting and bank account relations are a later COM-N/K integration, so L10 stores verified evidence, not a paid Expense or journal. No financial execution endpoint.
- Owner already decided approved currency semantics: raw provider count/usage/rates/costs preserve 24,10 decimal strings and signs; customer contracts stay integer cents. Do not silently use abs, floats or unknown-as-zero.

## Acceptance B
1. Add TelecomSyncCursor(accountId, resource, window boundaries, checkpoint/claim, last success/failure/error) with unique account/resource, monotonic-window/claim constraints; no page checkpoint advanced by schema alone.
2. Add TelecomUsageSnapshot(accountId, category, provider GMT dates, count/usage Decimal(24,10), nullable price, currency, observation time, source/payload hash, total flag), append-safe unique observation key; correction snapshots must not replace prior rows.
3. Add CommunicationCostFact(accountId, optional number/attempt/call leg and rate/statement links, signed amount Decimal(24,10), nullable quantity, classification, sourceKey and optional supersession) with account-specific FKs or cross-account trigger guard, and unique source key/classification.
4. Add TelecomRateVersion (provider/owner source, effective interval and canonical destinationKey) and TelecomStatement (private evidence/hash, cents, period, revision, draft/verified/superseded) with no auto-posting. Currency/dates/revision and private reference constraints.
5. Single additive migration SQL and reversibly restored model manifest; no destructive changes, existing production rows unaffected. SQL CHECKs reject negative counts but permit negative credits/refunds/usage adjustments as appropriate; account scope is enforced in DB.
6. One named Decimal helper takes decimal strings or Prisma.Decimal, refuses JS float, compares basis/currency, preserves source sign, rounds **once** to integer cents at output boundary, rejects unsafe precision and NaN/infinite.
7. Unit precision, signed/refund/null/edge tests; disposable PostgreSQL schema/constraint, replay/supersession and restoring backup tests; typecheck, lint, schema/route/secrets/migration checks, exact-head CI, self diff review. Automated review unavailable — waived.

## Deferred
L11 is the read-only provider retrieval/paging engine and price observation handling. L12 computes estimates/statement reconciliation/budget alerts. L13+ integrate screens/activation. L10 does **not** create any sync job, provider charge, invoice, sending, media capture or public price.
