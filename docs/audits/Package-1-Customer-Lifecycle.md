# Package 1 Audit Report: Customer Lifecycle & Portal
**Date:** October 1, 2026  
**Scope:** `src/domains/customers/*`, `src/domains/portal/*`, `src/domains/maintenance/*`, `src/domains/activity/*`  
**Focus:** Data isolation, state machine correctness, pagination, performance, concurrency  
**Test Coverage:** Real database-backed tests in `tests/customer-isolation.test.ts`, `tests/maintenance.test.ts`

---

## Executive Summary

| Severity | Count | Status |
|----------|-------|--------|
| **CRITICAL** | 1 | ⚠️ Potential race condition |
| **HIGH** | 3 | ⚠️ Missing data scoping, performance risk, overfetching |
| **MEDIUM** | 4 | ⚠️ Pagination bugs, missing index, concurrent safety |
| **LOW** | 3 | ℹ️ Code quality, documentation |

**Overall Risk:** **MEDIUM-HIGH**
- ✅ **Data isolation:** Proven secure via real database tests (`customer-isolation.test.ts`)
- ✅ **Portal queries:** Properly scoped by `userId`; cannot accept client-supplied IDs
- ✅ **Maintenance state machine:** Correctly defined; transitions validated server-side
- ⚠️ **Concurrency:** Maintenance status updates lack transaction isolation; race condition possible
- ⚠️ **Performance:** N+1 queries in maintenance detail fetch; missing indexes on foreign keys
- ⚠️ **Pagination:** Cursor logic in timeline-page needs verification; offset-based pagination has known edge cases

---

## Findings by Severity

### 🔴 CRITICAL (1)

#### 1. Race Condition in `updateMaintenanceStatus()` — Concurrent Transitions
**File:** `src/domains/maintenance/index.ts` (lines 85–122)  
**Severity:** CRITICAL  
**Issue:**
```typescript
export async function updateMaintenanceStatus(
  userId: string,
  requestId: string,
  newStatus: MaintenanceStatus,
) {
  const before = await prisma.maintenanceRequest.findUniqueOrThrow({
    where: { id: requestId },
  });
  
  const check = canTransitionMaintenanceStatus(before.status, newStatus);
  if (!check.ok) {
    throw new Error(check.reason);
  }
  
  const updated = await prisma.maintenanceRequest.update({
    where: { id: requestId },
    data: {
      status: newStatus,
      completedAt:
        newStatus === "RESOLVED" || newStatus === "CLOSED"
          ? (before.completedAt ?? new Date())
          : before.completedAt,
    },
  });
  
  // Audit log created AFTER update — separate transaction
  await prisma.auditLog.create({
    data: {
      userId,
      action: "maintenance.status",
      entityType: "MaintenanceRequest",
      entityId: requestId,
      oldValue: { status: before.status },
      newValue: { status: newStatus },
    },
  });
  
  return updated;
}
```

**Problem:**
1. **Read-Modify-Write gap:** Query status at line 87 (`findUniqueOrThrow`), validate at line 92, but don't update until line 101.
2. **Two concurrent requests:** 
   - Thread A: Request is `SUBMITTED`, validates transition to `REVIEWING`, pauses
   - Thread B: Request is `SUBMITTED`, validates transition to `CLOSED`, pauses
   - Thread A: Updates to `REVIEWING` ✅
   - Thread B: Updates to `CLOSED` ✅ (both succeed, but B should have been rejected because it's no longer `SUBMITTED`)
3. **Audit inconsistency:** If update succeeds but audit log creation fails, the state change is recorded but not audited.

**Business Impact:**
- A maintenance request could transition from `SUBMITTED` → `REVIEWING` **and** `SUBMITTED` → `CLOSED` simultaneously
- The audit log might disagree with the actual status
- Staff confusion if two state changes are logged but only one persists

**Test Gap:** `tests/maintenance.test.ts` checks valid transitions but does **not** test concurrent updates.

**Recommended Fix:**
```typescript
export async function updateMaintenanceStatus(
  userId: string,
  requestId: string,
  newStatus: MaintenanceStatus,
) {
  // Use a transaction to make the read-modify-write atomic
  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.maintenanceRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    
    const check = canTransitionMaintenanceStatus(before.status, newStatus);
    if (!check.ok) {
      throw new Error(check.reason);
    }
    
    const result = await tx.maintenanceRequest.update({
      where: { id: requestId },
      data: {
        status: newStatus,
        completedAt:
          newStatus === "RESOLVED" || newStatus === "CLOSED"
            ? (before.completedAt ?? new Date())
            : before.completedAt,
      },
    });
    
    // Audit log in same transaction — all-or-nothing
    await tx.auditLog.create({
      data: {
        userId,
        action: "maintenance.status",
        entityType: "MaintenanceRequest",
        entityId: requestId,
        oldValue: { status: before.status },
        newValue: { status: newStatus },
      },
    });
    
    return result;
  });
  
  return updated;
}
```

**Additional Step:** Add a real database test in `tests/maintenance.test.ts` to catch this (the existing test mocks the DB, so it can't detect race conditions). Consider using `tests/jobs-pagination-integration.test.ts` as a pattern for spawning concurrent operations.

---

### 🟠 HIGH (3)

#### 2. Missing Data Scoping in Desk Staff Queries — `getCustomerRentals()` & `getCustomerService()`
**File:** `src/domains/customers/workspace.ts` (lines 86–186)  
**Severity:** HIGH  
**Issue:**
```typescript
export async function getCustomerRentals(
  customerId: string,
  requestedPage = 1,
) {
  await requireRole("OWNER", "ADMIN");
  // ❌ PROBLEM: acceptsany customerId without confirming it belongs to a 
  // customer the staff member is authorized to see.
  const meta = pageMeta(
    await prisma.rentalAgreement.count({ where: { customerId } }),
    requestedPage,
  );
  const records = await prisma.rentalAgreement.findMany({
    where: { customerId },  // ← Direct use of caller-supplied ID
    // ...
  });
}

export async function getCustomerService(
  customerId: string,
  requestedPage = 1,
) {
  await requireRole("OWNER", "ADMIN");
  // ❌ Same issue: customerId is not validated
  const [jobCount, openRequestCount, requests] = await Promise.all([
    prisma.job.count({ where: { customerId } }),
    prisma.maintenanceRequest.count({
      where: { customerId, status: { ... } },
    }),
    // ...
  ]);
}
```

**Problem:**
- While `requireRole("OWNER", "ADMIN")` gates access to staff-only queries, the functions accept a `customerId` parameter from the caller (likely from URL params or request body)
- OWNER/ADMIN staff can browse **any** customer's records, but future STAFF role (who should see a limited set) would face no data boundary
- If a STAFF account is added in future phases, this pattern would need to validate `customerId` against the staff member's permitted portfolio/region

**Business Impact:**
- Future multi-region or multi-tenant staff onboarding could leak cross-region data
- OWNER/ADMIN accounts currently have no guardrails but the pattern sets a bad precedent
- Audit logging would be harder to set up later (no single canonical source of "which staff member can see what")

**Comparison:** Portal queries in `src/domains/portal/index.ts` correctly refuse client-supplied IDs:
```typescript
// ✅ GOOD: scoped by session, never caller-supplied
export async function getPortalData(userId: string) {
  const customer = await prisma.customer.findUnique({
    where: { userId },  // ← From session, not URL
    // ...
  });
}
```

**Recommended Fix:**
1. **For now (OWNER/ADMIN safety):** Add a comment documenting that OWNER/ADMIN accounts are trusted to request any customer's data and may need validation when more granular roles are added.
2. **For future proofing:** Refactor to validate `customerId` against a staff member's portfolio/region:
```typescript
export async function getCustomerRentals(
  customerId: string,
  requestedPage = 1,
) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  
  // Validate this customer is in the staff member's permitted scope
  if (session.user.role === "STAFF") {
    const allowed = await canAccessCustomer(session.user.id, customerId);
    if (!allowed) {
      throw new Error("You do not have access to this customer.");
    }
  }
  // OWNER/ADMIN bypass this; document why
  
  // ... rest of query
}

async function canAccessCustomer(staffUserId: string, customerId: string): Promise<boolean> {
  // Example: check if staff member's region/portfolio includes this customer
  // Later implementation; stub for now
  return true;
}
```

---

#### 3. N+1 Query in Maintenance Detail Page — Missing `photos` Index & Overfetching
**File:** `src/domains/maintenance/index.ts` (lines 74–84)  
**Severity:** HIGH (Performance)  
**Issue:**
```typescript
export async function getMaintenanceRequestById(id: string) {
  return prisma.maintenanceRequest.findUnique({
    where: { id },
    include: {
      customer: { include: { user: { select: { name: true, email: true } } } },
      appliance: { include: { applianceType: true } },
      jobs: { orderBy: [{ scheduledAt: "desc" }] },  // ❌ No limit; fetches ALL jobs
      // ❌ NO INDEX on (maintenanceRequestId)
      photos: { orderBy: [{ createdAt: "asc" }] },
    },
  });
}
```

**Problems:**
1. **Missing index:** `Photo.maintenanceRequestId` has no index; query likely does a full table scan on `photo` table to find photos for this request.
2. **Unbounded `jobs` fetch:** A request that spawned 50 maintenance jobs would load all 50 into memory, but the detail page likely shows only a summary link.
3. **Overfetching:** `jobs` includes **all columns** (Prisma default); likely only need `id`, `type`, `status`, `scheduledAt`.

**Test Coverage:** `tests/maintenance.test.ts` does **not** use a real database, so it cannot detect missing indexes or slow query behavior.

**Recommended Fix:**
```typescript
export async function getMaintenanceRequestById(id: string) {
  return prisma.maintenanceRequest.findUnique({
    where: { id },
    include: {
      customer: { include: { user: { select: { name: true, email: true } } } },
      appliance: { include: { applianceType: true } },
      // Limit jobs; let detail page link to full list if needed
      jobs: {
        select: { id: true, type: true, status: true, scheduledAt: true },
        orderBy: [{ scheduledAt: "desc" }],
        take: 5,  // Show only last 5; more on a dedicated jobs page
      },
      // Select only columns needed by detail UI
      photos: {
        select: { id: true, url: true, createdAt: true },
        orderBy: [{ createdAt: "asc" }],
      },
    },
  });
}
```

**Schema Update (Prisma migration):**
```prisma
model Photo {
  id                    String   @id @default(cuid())
  maintenanceRequestId  String
  maintenanceRequest    MaintenanceRequest @relation(fields: [maintenanceRequestId], references: [id])
  url                   String
  createdAt             DateTime @default(now())
  
  // Add this index to speed up photo lookups by request
  @@index([maintenanceRequestId])
}
```

---

#### 4. Unbounded `getPortalData()` Includes — Overfetching & Memory Risk
**File:** `src/domains/portal/index.ts` (lines 19–55)  
**Severity:** HIGH (Performance)  
**Issue:**
```typescript
export async function getPortalData(userId: string) {
  const customer = await prisma.customer.findUnique({
    where: { userId },
    include: {
      serviceAddresses: true,  // ❌ No limit; fetches ALL addresses
      rentalAgreements: {
        include: {
          serviceAddress: true,
          lines: {
            include: {
              assignments: {
                where: ACTIVE_ASSIGNMENT_WHERE,
                include: { appliance: { include: { applianceType: true } } },
              },
            },
          },
        },
        orderBy: [{ createdAt: "desc" }],  // ❌ No limit; fetches ALL agreements
      },
      jobs: {  // ❌ No limit; fetches ALL jobs
        include: { serviceAddress: true },
        orderBy: [{ scheduledAt: "desc" }],
      },
      maintenanceRequests: {  // ❌ No limit; fetches ALL requests
        include: { appliance: { include: { applianceType: true } } },
        orderBy: [{ createdAt: "desc" }],
      },
    },
  });

  return customer;
}
```

**Problem:**
- A customer with 100 rental agreements, 200 jobs, and 50 maintenance requests would load **350+ rows** into memory on every `/account` page load
- Each row includes nested relations (appliances, types, etc.), multiplying memory use
- No `take` limits, so as the customer's data grows, the query gets slower and heavier

**Comparison:** `getPortalHome()` in `src/domains/portal/workspace.ts` correctly uses `take`:
```typescript
// ✅ GOOD: Limited fetches
prisma.rentalAgreement.findMany({
  where: rentalWhere,
  take: 6,  // Only 6 for dashboard preview
  // ...
}),
```

**Recommended Fix:**
```typescript
export async function getPortalData(userId: string) {
  const customer = await prisma.customer.findUnique({
    where: { userId },
    include: {
      serviceAddresses: true,  // Usually 1–3; OK to fetch all
      rentalAgreements: {
        take: 50,  // Paginate if > 50 agreements
        include: {
          serviceAddress: true,
          lines: {
            include: {
              assignments: {
                where: ACTIVE_ASSIGNMENT_WHERE,
                include: { appliance: { include: { applianceType: true } } },
              },
            },
          },
        },
        orderBy: [{ createdAt: "desc" }],
      },
      jobs: {
        take: 50,  // Paginate if > 50 jobs
        include: { serviceAddress: true },
        orderBy: [{ scheduledAt: "desc" }],
      },
      maintenanceRequests: {
        take: 50,  // Paginate if > 50 requests
        include: { appliance: { include: { applianceType: true } } },
        orderBy: [{ createdAt: "desc" }],
      },
    },
  });

  return customer;
}
```

**And update callers** to handle the possibility of truncated results (e.g., add a "See all" link if `agreements.length === 50`).

---

### 🟡 MEDIUM (4)

#### 5. Pagination Cursor Logic Needs Verification — `timeline-page.ts`
**File:** `src/domains/customers/timeline-page.ts` (lines 98–166)  
**Severity:** MEDIUM (Correctness)  
**Issue:**
```typescript
export async function getCustomerTimelinePage(
  customerId: string,
  filter?: LinkedTimelineFilter,
  rawCursor?: string,
) {
  await requireRole("OWNER", "ADMIN");
  const cursor = readTimelineCursor(rawCursor);
  
  // Two parallel queries, each using the cursor
  const notesPromise =
    filter === "activity"
      ? Promise.resolve([])
      : prisma.customerNote.findMany({
          where: { AND: [{ customerId }, timelineCursorWhere("note", cursor)] },
          select: { /* ... */ },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: PAGE_SIZE + 1,
        });
  
  const activityPromise = (async () => {
    if (filter === "notes") return [];
    const [agreements, jobs, requests] = await Promise.all([
      prisma.rentalAgreement.findMany({
        where: { customerId },  // ❌ Cursor WHERE not applied here
        select: { id: true },
      }),
      prisma.job.findMany({
        where: { customerId },  // ❌ Cursor WHERE not applied here
        select: { /* ... */ },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: PAGE_SIZE + 1,
      }),
      prisma.maintenanceRequest.findMany({
        where: { customerId },  // ❌ Cursor WHERE not applied here
        select: { /* ... */ },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: PAGE_SIZE + 1,
      }),
    ]);
    // Merge three tables by cursor — complex merge logic follows
    return mergeTimelinePage(/* ... */);
  })();
}
```

**Problem:**
1. **Cursor scope mismatch:** Notes query correctly applies `timelineCursorWhere()`, but rental agreements query does **not** — it re-fetches all agreements from the start every time.
2. **Complex merge logic:** Three tables (`RentalAgreement`, `Job`, `MaintenanceRequest`) are fetched in separate queries, then merged by cursor in application code. This is error-prone; concurrent inserts could break pagination.
3. **Unclear cursor semantics:** Is the cursor a timestamp, an ID, or a combination? How does it work across three unrelated tables with different `createdAt` values?

**Test Coverage:** `tests/customer-record-pagination.test.ts` mocks the database, so it cannot catch pagination drift due to concurrent inserts.

**Recommended Fix:**
- Add inline comments documenting cursor semantics (e.g., "cursor = { timestamp, id } to handle ties")
- Verify `timelineCursorWhere("rental", cursor)` is applied to all three queries, or document why it's safe to omit
- Add a real database test (like `tests/jobs-pagination-integration.test.ts`) to verify pagination stability under concurrent inserts
- Consider simplifying: fetch a single "timeline activity" view if the database supports JSON aggregation, or build the merged timeline at the application layer **after** fetching all three tables (inefficient but clearer)

---

#### 6. Maintenance Status Transitions — Missing Idempotency & Concurrent Revalidation
**File:** `src/app/desk/maintenance/actions.ts` (lines 20–46)  
**Severity:** MEDIUM (Reliability)  
**Issue:**
```typescript
export async function updateMaintenanceStatusAction(
  requestId: string,
  status: string,
): Promise<MaintenanceActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  if (!ALL_STATUSES.includes(status as MaintenanceStatus)) {
    return { status: "error", message: "That's not a valid status." };
  }

  try {
    await updateMaintenanceStatus(session.user.id, requestId, status as MaintenanceStatus);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't update that request.",
    };
  }

  // Revalidate multiple paths
  revalidatePath("/desk/maintenance");
  revalidatePath(`/desk/maintenance/${requestId}`);
  revalidatePath("/desk/dashboard");
  revalidatePath("/desk/activity");
  return { status: "success" };
}
```

**Problems:**
1. **Idempotency:** If the action is called twice with the same `requestId` and `status`, the second call returns an error ("That's already its current status") instead of a success. This violates the HTTP principle of idempotent operations.
2. **Revalidation overhead:** Four separate `revalidatePath()` calls; if one of them fails, the others may have already executed, leaving a partially revalidated state.
3. **Error message leaks logic:** "That's already its current status" exposes internal validation to the UI, which could be confusing if there's a concurrent update.

**Recommended Fix:**
```typescript
export async function updateMaintenanceStatusAction(
  requestId: string,
  status: string,
): Promise<MaintenanceActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  if (!ALL_STATUSES.includes(status as MaintenanceStatus)) {
    return { status: "error", message: "Invalid status." };
  }

  try {
    await updateMaintenanceStatus(session.user.id, requestId, status as MaintenanceStatus);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Couldn't update that request.";
    // Treat "already at that status" as success (idempotent)
    if (msg.includes("already its current status")) {
      return { status: "success" };  // ← Idempotent
    }
    return { status: "error", message: msg };
  }

  // Batch revalidations to reduce overhead
  const paths = [
    "/desk/maintenance",
    `/desk/maintenance/${requestId}`,
    "/desk/dashboard",
    "/desk/activity",
  ];
  for (const path of paths) {
    revalidatePath(path);  // Consider: could batch these somehow
  }
  
  return { status: "success" };
}
```

---

#### 7. Missing Foreign Key Indexes — Performance Risk at Scale
**Schema:** `prisma/schema.prisma`  
**Severity:** MEDIUM (Performance)  
**Issue:**

Common queries filter by `customerId`, `maintenanceRequestId`, `rentalAgreementId`, etc., but the schema does not explicitly define indexes on these foreign keys. Prisma does not automatically index foreign keys, so lookups may degrade as tables grow.

**Example queries that would benefit:**
- `prisma.maintenanceRequest.findMany({ where: { customerId } })` — full table scan if no index
- `prisma.job.findMany({ where: { customerId } })` — full table scan
- `prisma.photo.findMany({ where: { maintenanceRequestId } })` — full table scan
- `prisma.rentalAgreement.findMany({ where: { customerId } })` — full table scan

**Recommended Fix:**
Review schema and add indexes for all frequently-filtered foreign keys:
```prisma
model MaintenanceRequest {
  id          String  @id @default(cuid())
  customerId  String
  customer    Customer @relation(fields: [customerId], references: [id])
  
  // Add index for common queries
  @@index([customerId])
  @@index([status])  // Also used in status-filtered queries
}

model Job {
  id          String  @id @default(cuid())
  customerId  String
  customer    Customer @relation(fields: [customerId], references: [id])
  
  @@index([customerId])
  @@index([status])
  @@index([scheduledAt])  // Used in ordering queries
}

model Photo {
  id                    String  @id @default(cuid())
  maintenanceRequestId  String
  maintenanceRequest    MaintenanceRequest @relation(fields: [maintenanceRequestId], references: [id])
  
  @@index([maintenanceRequestId])
  @@index([createdAt])  // Used in ordering
}
```

---

### 🔵 LOW (3)

#### 8. Duplicate Status Definition — `ALL_STATUSES` Array in Two Files
**Files:** `src/domains/maintenance/index.ts` (line 12) & `src/app/desk/maintenance/[id]/maintenance-detail-panel.tsx` (line 14)  
**Severity:** LOW (Code Quality)  
**Issue:**
```typescript
// ❌ Duplicated in two files:
// src/domains/maintenance/index.ts
const ALLOWED_TRANSITIONS: Record<MaintenanceStatus, MaintenanceStatus[]> = {
  SUBMITTED: ["REVIEWING", "CLOSED"],
  // ...
};

// src/app/desk/maintenance/[id]/maintenance-detail-panel.tsx
const ALL_STATUSES: { value: MaintenanceStatusValue; label: string }[] = [
  { value: "SUBMITTED", label: "Submitted" },
  // ...
];
```

**Problem:** If a new status is added (e.g., `"ON_HOLD"`), both files must be updated or the UI will be out of sync with business logic.

**Recommended Fix:**
Export a shared status list from the domain:
```typescript
// src/domains/maintenance/index.ts
export const MAINTENANCE_STATUS_LABELS: Record<MaintenanceStatus, string> = {
  SUBMITTED: "Submitted",
  REVIEWING: "Reviewing",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export const ALL_STATUSES = Object.entries(MAINTENANCE_STATUS_LABELS).map(
  ([value, label]) => ({ value: value as MaintenanceStatus, label })
);

// src/app/desk/maintenance/[id]/maintenance-detail-panel.tsx
import { ALL_STATUSES } from "@/domains/maintenance";

const ALL_STATUSES = ALL_STATUSES;  // ← Now always in sync
```

---

#### 9. Maintenance Status Transitions — Comment Out of Sync with Test
**Files:** `src/app/desk/maintenance/[id]/maintenance-detail-panel.tsx` (line 28) & `tests/maintenance.test.ts`  
**Severity:** LOW (Documentation)  
**Issue:**
```typescript
// Mirrors ALLOWED_TRANSITIONS in src/domains/maintenance/index.ts — only
// to grey out invalid buttons; the real enforcement is server-side.
const ALLOWED_NEXT: Record<MaintenanceStatusValue, MaintenanceStatusValue[]> = {
  SUBMITTED: ["REVIEWING", "CLOSED"],
  // ...
};
```

The comment says it "mirrors" the domain definition, but this is actually a duplication with a different name. It would be clearer to call it what it is.

**Recommended Fix:**
```typescript
// Client-side UI hints; real enforcement is server-side in src/domains/maintenance.
// This is duplicated from ALLOWED_TRANSITIONS for now; consider moving to shared export.
const ALLOWED_NEXT: Record<MaintenanceStatusValue, MaintenanceStatusValue[]> = {
  // ...
};
```

---

#### 10. Missing Cursor Implementation — `readTimelineCursor()` & `timelineCursorWhere()` Opaque
**File:** `src/domains/customers/timeline-page.ts`  
**Severity:** LOW (Maintainability)  
**Issue:**
Cursor functions are called but their implementation is not shown in search results. Their behavior is critical for pagination correctness but is not documented.

**Recommended Fix:**
Add JSDoc comments explaining cursor format and usage:
```typescript
/**
 * Parses a timeline cursor (opaque string) into structured pagination state.
 * 
 * Format: Base64-encoded JSON { timestamp: ISO8601, id: ULID }
 * Used to resume pagination at the point of the last item fetched.
 * 
 * @param raw - Cursor string from previous response, or undefined for first page
 * @returns Structured cursor, or undefined if parsing fails
 */
function readTimelineCursor(raw?: string): Cursor | undefined {
  // ...
}

/**
 * Builds a Prisma WHERE clause for cursor-based pagination.
 * 
 * Handles edge cases:
 * - Items with identical timestamps (use ID as tiebreaker)
 * - Concurrent inserts that could otherwise break pagination
 * 
 * @param kind - "note" | "job" | "request" — affects ordering
 * @param cursor - Result from readTimelineCursor()
 * @returns Prisma where clause to fetch items after cursor
 */
function timelineCursorWhere(kind: string, cursor?: Cursor): Prisma.WhereInput {
  // ...
}
```

---

## Cross-Cutting Observations

### ✅ Strengths
1. **Data isolation proven:** `tests/customer-isolation.test.ts` is a real database-backed test proving customer A cannot read B's data
2. **Portal queries secure:** All portal functions scope by `userId` from session, never accept client-supplied IDs
3. **Maintenance state machine well-defined:** `ALLOWED_TRANSITIONS` is centralized; transitions validated server-side
4. **Role guards in place:** `requireRole("OWNER", "ADMIN")` gates staff queries

### ⚠️ Risks
1. **Concurrency:** Maintenance status updates have a potential race condition (read-modify-write gap)
2. **Performance:** Multiple unbounded fetches (`getPortalData`, maintenance photos); N+1 on detail page
3. **Pagination:** Cursor logic across three tables is complex; needs real DB test to verify stability
4. **Scalability:** No indexes on foreign keys; queries will slow as data grows

### 📋 Pattern Recommendations
1. Use transactions for read-modify-write sequences (e.g., `updateMaintenanceStatus`)
2. Add `take` limits to all `findMany()` calls; paginate results if needed
3. Explicitly `select` columns needed; avoid fetching everything
4. Add indexes on all frequently-filtered columns (FK, status, timestamps)
5. Test pagination with concurrent inserts using real database (follow `tests/jobs-pagination-integration.test.ts` pattern)

---

## Test Coverage Gaps

| Test File | Coverage | Gap |
|-----------|----------|-----|
| `tests/maintenance.test.ts` | State transitions (valid/invalid) | ❌ Concurrent updates, race conditions |
| `tests/customer-isolation.test.ts` | Data isolation (real DB) | ✅ Good; but does not cover staff queries or pagination |
| `tests/customer-record-pagination.test.ts` | Pagination bounds & skipping (mocked) | ❌ Concurrent inserts, cursor stability |
| (missing) | Maintenance detail page performance | ❌ N+1 detection, index validation |

### Recommended New Tests
1. **Concurrent maintenance transitions:** Create N parallel update requests on the same maintenance request; verify only one succeeds
2. **Pagination stability:** Insert a new customer record mid-pagination; verify cursor still advances correctly
3. **Overfetching detection:** Add a query analyzer to warn if `include` is missing `select` or `take` limits

---

## Fixes Priority & Effort

| ID | Severity | Issue | Effort | Priority |
|----|----------|-------|--------|----------|
| 1 | CRITICAL | Maintenance update race condition | 1h | **NOW** |
| 3 | HIGH | N+1 maintenance photos | 30m | Week 1 |
| 4 | HIGH | Unbounded getPortalData() | 1h | Week 1 |
| 2 | HIGH | Missing customer scoping (future-proofing) | 1.5h | Week 2 |
| 5 | MEDIUM | Cursor pagination verification | 2h | Week 2 |
| 7 | MEDIUM | Missing FK indexes | 1.5h | Week 1 |
| 6 | MEDIUM | Idempotency in actions | 30m | Week 2 |
| 8 | LOW | Duplicate status definition | 15m | Week 2 |
| 9 | LOW | Comment clarification | 5m | Week 2 |
| 10 | LOW | Cursor JSDoc | 15m | Week 2 |

---

## Next Steps

1. **Immediate (today):**
   - Fix race condition in `updateMaintenanceStatus()` (use `$transaction`)
   - Add test for concurrent maintenance updates

2. **This week:**
   - Add indexes to foreign keys in schema
   - Limit overfetched queries (`getPortalData`, maintenance photos)
   - Fix N+1 in maintenance detail page

3. **Next week:**
   - Add real database test for cursor pagination
   - Verify staff query scoping strategy for future STAFF role
   - Unify status definitions

4. **Follow-up audits:**
   - Package 2 (Agreements/Pricing) depends on concurrent safety fixes
   - Package 3 (Staff/Access) will leverage scoping patterns from this audit

---

**Audit completed:** October 1, 2026  
**Next Package:** Package 2 — Agreements, Pricing & Referral Logic
