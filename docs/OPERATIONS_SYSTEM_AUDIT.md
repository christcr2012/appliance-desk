# Operations System Audit: Inventory, Jobs, Work Orders, Repairs, Purchasing, Dispatch

## How to read this document

Everything below is written against what already exists in the repository, not a hypothetical replacement. Every recommendation says explicitly: "extend this existing model/function" or "add this new table that plugs into what's already there." Nothing here proposes ripping anything out. The current system is a genuinely well-built foundation — the gaps are mostly missing connective tissue between pieces that already exist, not structural flaws.

---

## Executive Summary

The operations system (appliance lifecycle, jobs/dispatch, guided actions, purchasing/parts) is more mature than most small-business systems at this stage. It already includes:

- A real, enforced appliance-status state machine (not just a free-text field)
- Atomic guided actions (repair, swap, retire, inspect) that move status + create jobs + write audit logs together, so they can never drift out of sync
- Race-condition protection on every status change (the "someone else just changed this" guard)
- A dispatch board with conflict detection
- A basic purchasing/parts system with stock tracking
- Early-stage profitability/ROI analytics per appliance

What's missing is not "better code" — it's **missing connective layers**: no real work-order cost rollup, no parts-to-job linkage, no labor time tracking, no vendor/warranty tracking, no proactive maintenance scheduling, no unified "job costing" view, and no structured purchase-order numbering/lifecycle system (addressed in its own dedicated section below).

This audit is organized: job flow → inventory → work orders → purchasing/parts → repairs → deliveries → purchase order numbering & lifecycle, and finishes with a prioritized growth plan that builds *on* each existing piece.

---

## Part 1: Current State Audit, By Area

### 1.1 — Appliance Lifecycle State Machine

**What exists:** `src/domains/inventory/lifecycle.ts` correctly models the physical reality of a rental business — a machine isn't "rented" until it's actually delivered, and it isn't "available" again until someone has actually inspected it. `RETIRED` is correctly terminal.

**Strengths:**
- Pure function, zero DB dependency — testable and shareable between client and server
- Every transition has a reason it's allowed or not
- `applianceStatusOnJobCompleted` ties job completion directly to lifecycle movement — the smartest piece of design in the whole operations system, because the *job* (what actually happened in the field) drives the *appliance's* truth, not a separate manual step that can be forgotten

**Gaps:**
1. **No "why" captured on most transitions.** A retire requires a reason (good). A manual move to MAINTENANCE from the raw status buttons does not require one — only the guided "Start a repair" action does.
2. **No structured condition history over time** beyond a single free-text `condition` field — matters for damage-waiver disputes.
3. **No required link from MAINTENANCE back to a specific originating `MaintenanceRequest`** if one exists, when a repair is started directly from the appliance page.

### 1.2 — Jobs (Work Orders)

**What exists:** `src/domains/jobs/index.ts` implements a solid job state machine (`SCHEDULED → IN_PROGRESS → COMPLETED/CANCELLED`), race-safe status updates, automatic appliance-status side effects on completion, and billing-trigger integration.

**Strengths:**
- `applyJobCompletionToAppliances` runs inside the same transaction as the status change — atomic by design
- Billing start is deliberately outside the transaction and never allowed to fail the job completion
- `setJobRepairCosts` captures parts + labor cost per job — the foundation for job costing already exists
- The checklist system gives field accountability without blocking completion

**Gaps:**
1. **No link between a job's `partsCostCents` and an actual `PartRecord`/`PurchaseOrder`.** Chris types a dollar amount by hand — there's no structured line-item breakdown of which parts were used, in what quantity, at what cost. `recordPartUsage` (purchasing) and `setJobRepairCosts` (jobs) are two disconnected systems today.
2. **No labor time tracking**, only a labor cost dollar figure.
3. **No job priority/urgency field.**
4. **No job-level cost estimate vs. actual.**
5. **No structured record of parts ordered specifically for a job** — no link from a `PurchaseOrder` line back to the `Job` that needed it.
6. **Dispatch conflict detection is time-only, not resource-only** — fine for one person, will break down with multiple trucks/technicians.
7. **No post-completion follow-up tracking.**

### 1.3 — Guided Actions (Repair / Swap / Retire / Inspect)

**What exists:** `src/domains/inventory/guided-actions.ts` is the best-designed part of the whole operations system. Every guided action is atomic, race-safe, and writes a complete audit trail. The swap logic solves a real, previously-impossible operation cleanly.

**Strengths:**
- `findCurrentAssignment` correctly ties a repair/swap back to the actual customer/agreement context
- `getApplianceHistory` merges audit log + jobs + inspections into one timeline
- Inspection checklist is customizable via `BusinessSettings`, with a sane fallback default

**Gaps:**
1. **`startRepairForAppliance` and `setJobRepairCosts` are not connected to parts inventory at all.** Starting a repair doesn't check stock, doesn't suggest the part catalog for that model, and completing the repair doesn't decrement `PartRecord.quantityOnHand` automatically.
2. **No warranty tracking.**
3. **Swap candidates are filtered only by appliance type**, not by comparable feature set.
4. **No repeat-failure detection** for a specific unit or model line.

### 1.4 — Purchasing & Parts

**What exists:** `src/domains/purchasing/index.ts` is intentionally minimal: `Supplier` → `PurchaseOrder` (DRAFT → ORDERED → RECEIVED/CANCELLED) → receiving adds to `PartRecord.quantityOnHand`. `recordPartUsage` decrements it, clamped at zero. Reorder threshold flagging exists via `getLowStockParts`.

**Strengths:**
- Correctly deliberate about not over-building (no partial receiving, no approval workflow)
- Row-locking (`FOR UPDATE`) on part usage prevents concurrent-usage stock corruption
- Reorder threshold is opt-in per part, not forced

**Gaps:**
1. **No connection between a `PurchaseOrder` and the `Job` that triggered the need for it.**
2. **No connection between `recordPartUsage` and the specific `Job` the part was used on** — the single biggest missing link in the whole operations system.
3. **No vendor performance tracking** (on-time delivery, price trends, preferred supplier per part).
4. **No "needed but not in stock" visibility tied to upcoming scheduled jobs.**
5. **No automatic PO suggestion** from low-stock data.
6. **No structured PO numbering/lifecycle/"add to existing vs. create new" logic** — covered in its own dedicated section below, per explicit request.

### 1.5 — Dispatch & Delivery Scheduling

**What exists:** `src/domains/jobs/dispatch.ts` provides day/week/agenda views, conflict detection, and business-timezone-aware day boundaries (DST-safe, Colorado-specific).

**Strengths:**
- Pure, testable conflict logic
- Correctly treats unscheduled jobs as "needs attention" rather than silently invisible
- The 2-hour assumed duration is a sensible, honest simplification rather than fake precision

**Gaps:**
1. **No route optimization or geographic grouping.**
2. **No estimated drive time between consecutive jobs.**
3. **No per-job actual duration tracking**, so the "2 hours" assumption can never be refined with real data.
4. **No distinction between job types for conflict purposes** (a 15-minute swap vs. a 2-hour installation treated identically).
5. **No customer-facing delivery-window communication**, even though the underlying data already supports it.

---

## Part 2: Cross-Cutting Gap (The Real Story)

One pattern repeats across every area above: excellent individual state machines, but missing connective data between them.

```
Job (what happened)
  ↕ MISSING LINK
Parts used (what it cost in materials)
  ↕ MISSING LINK
Purchase Order (where the part came from / what it actually cost)
  ↕ MISSING LINK
Appliance profitability (what this unit is really costing you)
```

Today, `Job.partsCostCents` is a number typed by hand; `PartRecord.quantityOnHand` is decremented by a *separate* manual action (`recordPartUsage`); `PurchaseOrderLineItem.unitCostCents` holds the real purchase price but never flows forward into what a job "cost." Fleet analytics (`computeRepairCostCents`) sums `Job.partsCostCents`/`laborCostCents`, so profitability numbers are only as accurate as manual typing — even though the real numbers already exist elsewhere in the system.

This is the single highest-value fix available, and it doesn't require new concepts — it requires connecting three things that already exist.

---

## Part 3: Purchase Order Numbering, Lifecycle & "Add to Existing vs. Create New" Logic

### Why this needs its own section

A purchasing system should never require a person to invent or remember a PO number, and it should never leave "should this go on a new order or an existing one" as an unassisted judgment call. Real small-business purchasing systems solve this with a small set of standard rules — described here in plain terms, then implemented as an extension of the existing `PurchaseOrder` model.

### The standard rule set, explained plainly

1. **PO numbers are always auto-generated, never typed.** Exactly the same pattern already used for `Invoice.invoiceNumber` and `Estimate.estimateNumber` (`@unique @default(autoincrement())`). This is not a new concept in this codebase — it's the same trusted pattern applied to one more model.
2. **A purchase order is only "open for additions" while it is still `DRAFT`.** The moment it's marked `ORDERED` (Chris actually placed the order with the supplier), it is locked. Adding lines after that point would misrepresent what was actually ordered — the supplier already has a fixed version of the request.
3. **Therefore the real question is never "which PO number does this go on."** It's: *"Is there already a DRAFT purchase order open for this supplier? If so, add to it — otherwise, start a new one."* This is the one capability currently missing: a per-supplier "current open draft" lookup.
4. **Every PO should record where it came from** (provenance): manually started, triggered by a low-stock alert, or needed for a specific repair job. This directly satisfies the "make sure nothing falls through the cracks" goal that has run through every audit in this series.

### Implementation — all additive, built on existing functions

#### 1. Auto-generated PO numbers

```prisma
model PurchaseOrder {
  // ...existing fields...
  poNumber Int @unique @default(autoincrement())
}
```

One migration, zero behavior change to existing functions — `createPurchaseOrder` already returns the full row, so `poNumber` is simply now present on it. Display as `PO-0014` (padded) everywhere a PO is shown, instead of its internal `id`.

#### 2. "Open draft" lookup — the core missing piece

```typescript
/** The current DRAFT purchase order for this supplier, if one exists —
 * the "should this go on an existing order or start a new one" question,
 * answered automatically instead of left to memory. A supplier can only
 * ever have one open draft at a time (enforced by always checking here
 * before creating a new one), so a half-finished draft order to the
 * same supplier is never silently duplicated. */
export async function getOpenDraftPurchaseOrder(supplierId: string) {
  return prisma.purchaseOrder.findFirst({
    where: { supplierId, status: "DRAFT" },
    include: { lines: true },
    orderBy: [{ createdAt: "desc" }],
  });
}
```

#### 3. One smart entry point that replaces "always create new"

```typescript
export type AddToPurchaseOrderInput = {
  supplierId: string;
  line: NewPurchaseOrderLineItemInput;
  /** Where this request came from — manual entry, a low-stock flag, or a
   * specific job that needs the part. Purely provenance, same spirit as
   * Lead.createdByUserId — never changes behavior, only answers "why
   * does this PO exist" later. */
  origin: "manual" | "low_stock_alert" | "job_repair";
  originJobId?: string;
};

/**
 * The one function every "I need to buy this part" entry point in the
 * app should call — from the low-stock panel, from a job's "parts used,
 * but not in stock" flow, or from a manual purchase-order screen. Finds
 * this supplier's open DRAFT order (if any) and adds the line to it;
 * only creates a new PurchaseOrder if there genuinely isn't an open one.
 */
export async function addToOrCreatePurchaseOrder(
  userId: string,
  input: AddToPurchaseOrderInput,
) {
  const existingDraft = await getOpenDraftPurchaseOrder(input.supplierId);

  if (existingDraft) {
    await prisma.purchaseOrderLineItem.create({
      data: {
        purchaseOrderId: existingDraft.id,
        partRecordId: input.line.partRecordId ?? null,
        description: input.line.description,
        quantity: input.line.quantity,
        unitCostCents: input.line.unitCostCents ?? 0,
        jobId: input.originJobId ?? null,
      },
    });
    await prisma.auditLog.create({
      data: {
        userId,
        action: "purchase_order.line_added",
        entityType: "PurchaseOrder",
        entityId: existingDraft.id,
        newValue: { ...input.line, origin: input.origin },
      },
    });
    return { purchaseOrderId: existingDraft.id, addedToExisting: true };
  }

  const created = await createPurchaseOrder(userId, {
    supplierId: input.supplierId,
    lines: [input.line],
  });
  return { purchaseOrderId: created.id, addedToExisting: false };
}
```

#### 4. Surfacing the choice in the UI (keeping a human decision, removing the memory burden)

When adding a part to buy, the screen should say plainly:

> "ACME Appliance Parts already has an open order (PO-0014, 3 items, not yet placed). Add this to it, or start a new order instead?"

Two buttons: **"Add to PO-0014"** (default/recommended) and **"Start a new order"** (for the rare case of deliberately splitting a rush item from a routine restock). No PO number is ever typed by hand, in either path.

#### 5. Locking a purchase order once it's placed

The existing `markPurchaseOrderOrdered` already flips status to `ORDERED`. No change needed there — `addToOrCreatePurchaseOrder`'s lookup only searches `status: "DRAFT"`, so a placed order is automatically protected from being silently modified. Any new need always starts (or joins) a fresh draft.

#### 6. Provenance visibility on the purchase order itself

Each `PurchaseOrderLineItem` gains a nullable `origin` and `jobId` (the same `jobId` column proposed in the Job↔Purchasing link phase below). The PO's own detail page then shows, per line: "Added manually," "Added — low stock alert," or "Added — needed for Job #{jobId} ({job type})." This answers "why did we order this" months later without anyone having to remember.

#### 7. Acceptance criteria for this section

- No screen in the app ever asks Chris to type or choose a PO number.
- Adding a part to buy always surfaces "add to existing open order" as the default, with "start new" as a deliberate, secondary choice.
- A `DRAFT` order can always receive new lines; an `ORDERED`/`RECEIVED`/`CANCELLED` order never can.
- Every PO line shows why it exists (manual, low-stock, or job-driven) on the order's own detail page.

---

## Part 4: Growth Plan — Extending What Already Exists

Every item below states which existing table/function it builds on.

### Phase 1 (P0): Connect Job → Parts → Purchasing

**Extend, don't replace:**

1. Add a join table:
   ```prisma
   model JobPartUsage {
     id String @id @default(cuid())
     jobId String
     job Job @relation(fields: [jobId], references: [id], onDelete: Cascade)
     partRecordId String
     partRecord PartRecord @relation(fields: [partRecordId], references: [id])
     quantity Int
     unitCostCentsAtUse Int // snapshot of cost at time of use, same "frozen at the moment" pattern as RentalLine
     createdAt DateTime @default(now())
   }
   ```
2. On a job's own page (where `setJobRepairCosts` already lives), add a "Parts used" section calling a new `recordJobPartUsage(jobId, partRecordId, quantity)` that:
   - Calls the *existing* `recordPartUsage` unchanged (still decrements stock, still row-locks)
   - Creates the `JobPartUsage` row with the part's current cost snapshotted
   - Recomputes `Job.partsCostCents` automatically as the sum of `JobPartUsage.unitCostCentsAtUse * quantity`
3. `setJobRepairCosts` stays exactly as-is for labor cost and for job types that don't use tracked parts — purely additive precision, not a replacement.
4. Fleet analytics (`computeRepairCostCents`) needs no changes — it already sums `partsCostCents`, now populated accurately instead of by hand.

**Why this is the right first move:** smallest possible change with the biggest ripple effect. Profitability analytics, repair-cost reporting, and purchasing decisions are all currently downstream of a manually-typed dollar figure. Connecting the three pieces that already exist turns every number above it in the system from an estimate into a fact.

### Phase 2 (P0): Link Purchase Orders to the Job That Needed Them

1. Add a nullable `jobId` to `PurchaseOrderLineItem` (already referenced above in Part 3).
2. When creating a purchase-order line from a job's "parts used, but not in stock" flow, pre-fill this `jobId`.
3. A job's detail page gains a "Related purchase orders" panel, reusing `getPurchaseOrderById` filtered by `jobId`.

### Phase 3 (P1): Warranty & Repeat-Failure Tracking on the Existing Appliance Model

1. Add nullable `warrantyExpiresAt: DateTime?` and `warrantyProvider: String?` to `Appliance`.
2. `startRepairForAppliance` gains one check: if `warrantyExpiresAt` is in the future, show a banner — informational, never blocking.
3. `getApplianceHistory` gets one more derived flag: "3rd MAINTENANCE_VISIT job in 90 days," computed from data already fetched in that function. Surface as a banner and as a new `/desk/today` exception category, reusing the existing exception-inbox pattern.

### Phase 4 (P1): Parts Demand Forecasting on Top of Existing Dispatch Data

1. Add a sibling to `getLowStockParts`: `getUpcomingPartsNeeded(daysAhead)` that looks at scheduled `MAINTENANCE_VISIT` jobs via the existing job-query shape, cross-references appliance model number against `PartRecord.modelNumber`, and flags parts likely needed that are already low.
2. Surface next to the existing low-stock list on `/desk/parts` — same page, new section.

### Phase 5 (P1): One-Click Purchase Order Creation from Low-Stock/Forecasted Parts

1. Add `createPurchaseOrderFromLowStock(userId, supplierId, partRecordIds[])`, calling `addToOrCreatePurchaseOrder` (Part 3) for each flagged part, grouped by preferred supplier.
2. "Create draft PO" button on the low-stock panel.
3. No new schema required for this phase.

### Phase 6 (P2): Job Duration Learning (Replace the Flat Assumption with Real Data)

1. Add nullable `startedAt`/`actualDurationMinutes` to `Job`, populated automatically on the existing `SCHEDULED → IN_PROGRESS` and `→ COMPLETED` transitions inside the existing `updateJobStatus` transaction.
2. `ASSUMED_JOB_DURATION_MINUTES` becomes a fallback default; a new pure function `averageDurationForJobType` computes a real median once enough history exists.
3. `findConflictingJobIds` uses the job-type-specific duration where available.

### Phase 7 (P2): Route-Aware Scheduling (Geographic Grouping, Not Full Optimization)

1. Add a "group by city/zip" sort option to the existing dispatch day view, reusing `ServiceAddress.city`/`zip`.
2. A full routing-optimization engine (geocoding + routing API) is explicitly a later, separate investment — not justified at current job volume.

### Phase 8 (P2): Post-Completion Follow-Up (Reusing Existing Email Infrastructure)

1. Reuse the existing guarded `sendEmail` helper and cron-job pattern (billing reminders, late fees, estimate follow-ups) to add one more: a daily cron finding `DELIVERY`/`INSTALLATION` jobs completed exactly 1 day ago, sending a single "How did everything go?" email linking to the existing `MaintenanceRequest` submission flow for anything that's wrong.

---

## Part 5: Priority Table

| Phase | What it fixes | New tables/columns | Reuses existing logic |
| --- | --- | --- | --- |
| PO numbering & lifecycle | No auto PO numbers; no "add to existing vs. new" logic | 1 column (`poNumber`), 1 nullable `origin`/`jobId` on line items | `createPurchaseOrder`, `markPurchaseOrderOrdered` |
| 1 — Job↔Parts link | Inaccurate repair cost; disconnected parts usage | 1 join table | `recordPartUsage`, `computeRepairCostCents`, audit log pattern |
| 2 — PO↔Job link | No traceability for why a part was ordered | 1 nullable column | `createPurchaseOrder`, job detail page |
| 3 — Warranty & repeat-failure | Paying for repairs still under warranty; lemons going unnoticed | 2 nullable columns | `startRepairForAppliance`, `getApplianceHistory`, exception-inbox pattern |
| 4 — Parts demand forecast | Stock-outs during scheduled repairs | None | `getLowStockParts`, `getDispatchBoardJobs` |
| 5 — One-click PO creation | Manual, slow restocking | None | `addToOrCreatePurchaseOrder` |
| 6 — Real job duration data | Flat, never-improving conflict window | 2 nullable columns | `updateJobStatus`, `dispatch.ts` pure functions |
| 7 — Geographic grouping | Inefficient driving routes | None | `ServiceAddress`, dispatch day view |
| 8 — Post-completion follow-up | No feedback loop on service quality | None | `sendEmail`, cron pattern, `MaintenanceRequest` |

---

## Part 6: What to Build First, and Why

**Start with the Purchase Order numbering/lifecycle fix and Phase 1 (Job↔Parts link) together** — they share the same underlying column (`jobId` on `PurchaseOrderLineItem`) and solve the two most concrete, explicitly requested problems: never inventing a PO number, and never losing track of what a repair actually cost in real parts.

**Then Phase 3 (warranty/repeat-failure).** Pure upside with almost no engineering cost — two nullable columns and one derived flag reusing data already fetched — directly protecting cash and fleet quality.

Everything else (forecasting, PO automation, duration learning, routing, follow-up emails) is genuinely valuable but scales in importance with volume — the right next moves once the foundational links above are in place and more job history exists to learn from.

---

This document should be treated as the foundation for the operations-system modernization plan and any future implementation work in jobs, inventory, purchasing, and dispatch.
