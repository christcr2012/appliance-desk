# O-2A — Per-admin permission limits (capabilities)

Design: `docs/designs/BATCH-O.md` D-O2. Drift check (O-A2) done on main at the start of this card.

## What the check found
Every guard in the money functions below is exactly `["OWNER","ADMIN"]` inside the transaction, so swapping them for a
capability check keeps today's behavior for everyone who has no limit. Overall the code has ~200 owner/admin guards and
~110 owner-only guards; only the money functions below are touched.

| Capability | Functions now using it |
|---|---|
| RECORD_MANUAL_PAYMENT | `recordManualPayment` |
| WRITE_OFF | `writeOffInvoice` |
| RESOLVE_HELD_PAYMENT | `resolveHeldPaymentAsPaid`, `resolveHeldPaymentAsCredit` |
| REFUND_DEPOSIT | `decideDepositRefund` (both copies: deposit-refunds.ts, refunds-base.ts) |
| ISSUE_REFUND | `issueInvoiceRefund`, `refundHeldPayment` |
| EDIT_SETTINGS | `updateBusinessSettings`, settings undo |
| POST_EXPENSES | `postExpense`, `voidExpense` |

## Acceptance
- `StaffCapabilityOverride` (additive migration, one empty table). No rows = today's behavior.
- `assertCapability(tx, userId, capability)` = the same shared-lock re-check as `assertActiveTeamActor` plus the
  per-admin limit. OWNER always passes; ADMIN passes unless limited; STAFF and others never.
- `/desk/settings/permissions` (owner only, linked from Settings): per admin, per capability, Take away / Give back.
  Owner-only action, audit row `staff.capability` with before/after.
- Tests: `tests/capabilities.test.ts` (pure defaults), `tests/capabilities-integration.test.ts` (real Postgres: limit takes
  effect on the next action, restore, only the owner can change, never staff/owner/non-admin, settings save and a real
  money function honour it). Two fake-based tests updated to route the new check through their existing fakes.

## Not in this card (and why)
- **Granting anything to STAFF** (VIEW_REPORTS, POST_EXPENSES for staff): staff cannot open those desk screens today, so a
  grant widens access. Owner decision row added to the checklist (section E). Not built.
- **GRANT_CREDIT, EDIT_PRICES, EXPORT_DATA**: their guards are not uniform yet (price edits only check the page role; credit
  and export entry points are spread over several modules). Swapping them would change who can do what (stop rule S-O1), so
  they stay as they are; follow-up once each entry point is listed.
