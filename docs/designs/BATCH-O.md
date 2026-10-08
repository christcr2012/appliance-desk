# Design — Batch O: More owner controls

Status: **APPROVED DESIGN — implement from this document** (Chris, 2026-10-06: "I love all of this! Update the repo!"). Run the drift check in section 0 before starting.
Written 2026-10-06 by Claude Opus 5.5 against `main` 23eff64, from Part 3 of
`docs/reviews/2026-10-06-owner-audit-and-recommendations.md`. Runs after Batch K (approvals cover expense posting).
Scope and acceptance: `docs/PLAN.md` → Batch O.

**Who this is written for.** An implementing model following it literally. **Every control in this batch starts in
the position that changes nothing** — after migration the app behaves exactly as before until Chris turns something on.

---

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| O-A1 | Settings saves write `AuditLog` rows with `oldValue`/`newValue` (`src/domains/settings/index.ts`, `legal-approvals.ts`, the section save functions in `sections.ts`). List every settings `action` string. | grep `auditLog.create` in `src/domains/settings` |
| O-A2 | Money actions are guarded by `requireRole("OWNER", "ADMIN")` (or `assertActiveTeamActor` with a role list) in these domain functions: manual payment record, refund, refund-to-credit, credit grant, write-off, held-payment resolution, deposit refund, late-return waiver, price edits, settings saves, exports, expense post/void (Batch K). Produce the exact list (file:function:current guard) in the PR. | grep the guards in `src/domains/billing`, `src/domains/settings`, `src/domains/books` |
| O-A3 | `ApplianceType.monthlyPriceCents` and `PricingRule` (label, monthly/one-time price) hold current prices; agreements copy prices at creation (locked terms), estimates copy at quote time. | schema + `src/domains/pricing` |
| O-A4 | `METRICS` (`src/domains/reports/definitions.ts`) holds every reportable number with a key. | read |
| O-A5 | Today cards come from `src/domains/dashboard` / exceptions inbox (`src/domains/exceptions`). | read how a card is added |

---

## 1. Decisions

### D-O1 — Settings history with undo
Settings → History lists settings audit rows newest first in plain words ("Late fee grace days: 5 → 7, by Chris, Oct 6
2:14 pm"), using the field labels already in `section-config.ts`. **Undo** re-applies the old values of that one change
through the *same* section save function (same validation, same permission, writes a new audit row "Undo of …"). Undo is
offered only for rows whose section has a save function and whose fields have not changed again since (otherwise the
button explains why it is hidden). Undo never touches agreements that already locked their terms — the screen says so.

### D-O2 — Capabilities instead of only fixed roles
A fixed list of capabilities, each with a default per role that reproduces today's behaviour **exactly**:

| Capability | OWNER | ADMIN default | STAFF default | Grantable to STAFF |
|---|---|---|---|---|
| RECORD_MANUAL_PAYMENT | yes | yes | no | no |
| ISSUE_REFUND | yes | yes | no | no |
| GRANT_CREDIT | yes | yes | no | no |
| WRITE_OFF | yes | yes | no | no |
| RESOLVE_HELD_PAYMENT | yes | yes | no | no |
| REFUND_DEPOSIT | yes | yes | no | no |
| EDIT_PRICES | yes | yes | no | no |
| EDIT_SETTINGS | yes | yes | no | no |
| VIEW_REPORTS | yes | yes | no | yes |
| EXPORT_DATA | yes | yes | no | no |
| POST_EXPENSES | yes | yes | no | yes |

(Adjust the ADMIN defaults to match O-A2's real guards before writing the migration — the rule is "no behaviour change".)
`StaffCapabilityOverride(userId, capability, allowed)`; `can(actor, capability)` = OWNER → true; override if present
(and grantable to that role) → its value; else role default. `requireCapability(capability)` replaces
`requireRole(...)` in exactly the functions listed for O-A2 — nothing else. Only the OWNER edits overrides (Staff screen,
per person, switches with plain explanations). Customers are never affected.

### D-O3 — Approval limits
Per action kind (REFUND, CREDIT, WRITE_OFF, DEPOSIT_KEPT, EXPENSE): `approvalThresholdCents` (null = no approval needed;
**starting value null**). The screen suggests values ("Refunds over $100", "Write-offs over $50") with a button that
fills them, but does not turn them on by itself. When anyone except the OWNER starts an action at or above the threshold,
the domain function stores an `ApprovalRequest` (kind, the validated input as JSON, amount, requester) instead of acting,
and returns "Sent to the owner for approval". The owner sees it on Today and approves or declines with an optional note.
Approval runs the **original domain function** with the stored input, **acting as the approving owner** (so every
existing permission and `assertActiveTeamActor` check still applies), with the requester recorded in the audit row and
on the resulting record's notes, inside a transaction that row-locks the request,
re-validates the input against current data (if the invoice is now paid, the approval fails with a plain message and the
request becomes FAILED), records `executedAt` and the result id, and can run only once. Requests expire after
`approvalExpiryDays` (starting value 7). The owner's own actions never need approval.

### D-O4 — Price changes with a start date
"Schedule a price change": pick an appliance type price or a pricing rule, new amount, start date (Colorado). Stored as
`ScheduledPriceChange`; a nightly automation applies due changes through the existing price-save function (same audit),
once. Existing agreements never change (locked terms — the screen says so). Before saving, a preview shows how many open
estimates quote the old price and that they keep it until they expire. Cancel is allowed until applied.

### D-O5 — Goals and alerts
`BusinessGoal(metricKey from METRICS, month, target)`; Today shows "On pace / behind" using a straight line through the
month. Plus two owner settings with starting values: `idleApplianceAlertDays` (30: an appliance AVAILABLE longer than this
gets a Today card), `utilizationAlertPercent` (null = off). Each explained on screen with a restore button.

### D-O6 — One page of live switches
Settings → **Switches** is read-only: every on/off that affects customers or money, its current state, who changed it last
and when (from the audit log), and a link to where it is changed: live customer email, SMS, launch emails, automatic
renewals, paused automations, Stripe mode (test or live, read from the key prefix — the key is never shown), Colorado tax
lookup connected, two-step login roles, books start date, approval limits on/off. No new switches are created here.

## 2. Schema (additive) — migration `<timestamp>_batch_o_owner_controls`

```prisma
enum ApprovalKind { REFUND CREDIT WRITE_OFF DEPOSIT_KEPT EXPENSE }
enum ApprovalStatus { PENDING APPROVED DECLINED EXPIRED FAILED }

model StaffCapabilityOverride {
  userId     String
  capability String   // one of D-O2's names; validated in code
  allowed    Boolean
  updatedByUserId String
  updatedAt  DateTime @updatedAt
  @@id([userId, capability])
}

model ApprovalRequest {
  id              String         @id @default(cuid())
  kind            ApprovalKind
  status          ApprovalStatus @default(PENDING)
  input           Json
  amountCents     Int
  summary         String         // plain words shown to the owner
  requestedByUserId String
  decidedByUserId String?
  decidedAt       DateTime?
  decisionNote    String?
  executedAt      DateTime?
  resultRef       String?
  failureMessage  String?
  expiresAt       DateTime
  createdAt       DateTime       @default(now())
  @@index([status, createdAt])
}

model ScheduledPriceChange {
  id              String    @id @default(cuid())
  applianceTypeId String?
  pricingRuleId   String?
  field           String    // "monthlyPriceCents" | "oneTimePriceCents"
  newValueCents   Int
  startsOn        DateTime
  createdByUserId String
  appliedAt       DateTime?
  cancelledAt     DateTime?
  createdAt       DateTime  @default(now())
  @@index([startsOn, appliedAt])
}

model BusinessGoal {
  id          String   @id @default(cuid())
  metricKey   String
  periodKey   String   // "YYYY-MM"
  targetValue Int
  createdByUserId String
  createdAt   DateTime @default(now())
  @@unique([metricKey, periodKey])
}
```

`BusinessSettings`: `approvalThresholds Json @default("{}")`, `approvalExpiryDays Int @default(7)`,
`idleApplianceAlertDays Int @default(30)`, `utilizationAlertPercent Int?`.

## 3. Work units

> PR boundaries below are superseded by `docs/MASTER-ROADMAP.md` section 7 (smaller PRs, same work units and order).

**PR O-1:** WU-O1 settings history + undo; WU-O6 switches page. **PR O-2:** WU-O2 capabilities. **PR O-3:** WU-O3
approvals. **PR O-4:** WU-O4 scheduled prices; WU-O5 goals and alerts. **PR O-5:** docs (OWNER-GUIDE "Controls you have").

Tests (★ real Postgres): ★ `tests/settings-undo-integration.test.ts` (undo re-validates, writes audit, hidden when the
field changed again); `tests/capabilities.test.ts` (defaults equal today's guards for every listed function — table test
generated from O-A2's list; STAFF cannot be granted a non-grantable capability); ★
`tests/capabilities-integration.test.ts` (override grants/revokes take effect on the next request); ★
`tests/approvals-integration.test.ts` (below threshold acts immediately; above creates a request; approve executes once
under concurrency; stale input fails safely; expiry; owner bypass); ★ `tests/scheduled-price-integration.test.ts` (applies
once at start date, agreements unchanged, cancel before apply); `tests/goals-pace.test.ts` (pure pace math, DST month
edges); browser `e2e/owner-controls.spec.ts` (approve a refund on phone width; axe clean).

## 4. Stop-and-ask

- **S-O1** O-A2's guards are not uniform enough to swap for `requireCapability` without changing who can do what today.
- **S-O2** A money action cannot be re-run safely from stored input (it depends on browser state or a provider session).
- **S-O3** Undo would need to change data other than `BusinessSettings` (for example rows of another table).

## 2026-10-08 addition — ENH-O settings impact preview

O-1 uses the existing settings validation/save path to show a pure before/after
preview for supported consequential settings. State the effective date, affected
new transactions and preserved signed agreements. Preview does not write data,
call providers, change prices or reserve approvals. Persisted save revalidates
actor capability and the expected settings revision; stale preview returns a
refresh conflict instead of overwriting another owner's edit. Undo uses the
normal audited save/approval path, never bypasses authorization or activation.
Start with settings whose effects can be derived from existing contracts; label
unsupported impact as unavailable. Test preview purity, stale revision, changed
role, signed-snapshot preservation and required approval. Safe invariants remain
code constraints; configurable templates cannot disable them.
