# Appliance Desk - Repository Overview & Analysis

## Quick Summary

**Appliance Desk** is a TypeScript-based web application (98.9% TypeScript) designed to manage appliance maintenance requests and scheduling. It's built with Next.js and uses Prisma as an ORM to connect to a PostgreSQL database (Neon).

Think of it as a ticketing system where customers can submit maintenance requests for broken appliances, and an admin (Chris) reviews, schedules, and tracks these requests through a workflow until they're resolved.

---

## What This App Does (In Simple Terms)

Imagine you have a broken refrigerator. Here's what happens:

1. **Customer submits a request** → You go to your customer portal and describe the problem, maybe attach photos
2. **Chris gets notified** → He receives an email about your request
3. **Request moves through workflow** → Chris reviews it, schedules a technician job, marks it as "in progress," and eventually closes it
4. **Customer sees updates** → You can check your portal to see the current status of your request

The app manages all these statuses and ensures nothing falls through the cracks.

---

## Architecture Overview

### Tech Stack
- **Frontend**: React with Next.js (Server Components & Client Components)
- **Backend**: Next.js Server Actions (TypeScript)
- **Database**: PostgreSQL via Neon
- **ORM**: Prisma (type-safe database queries)
- **Authentication**: Session-based (with role checking)

### Main Features
- Browse and filter maintenance requests by status
- Move requests through a linear workflow: `SUBMITTED → REVIEWING → SCHEDULED → IN_PROGRESS → RESOLVED → CLOSED`
- Close out requests early from any status if needed (e.g., customer withdrew, duplicate)
- Link maintenance requests to scheduled jobs (technician visits)
- Pagination for viewing requests
- Search functionality for customers and appliances
- Audit logging (tracks who changed what and when)

---

## How It Works: The Maintenance Request Workflow

### The Status Flow

```
SUBMITTED 
    ↓
REVIEWING 
    ↓
SCHEDULED 
    ↓
IN_PROGRESS 
    ↓
RESOLVED 
    ↓
CLOSED (terminal — no transitions out)
```

**Key Rules:**
- Status transitions follow a strict linear order (can't skip steps)
- CLOSED is terminal (can't move out of it)
- **Exception:** Any non-terminal status can jump directly to CLOSED (you can cancel/close a request at any time)

### Code Organization

| Path | Purpose |
|------|---------|
| `src/domains/maintenance/` | Core business logic for status transitions |
| `src/app/desk/maintenance/` | Admin UI for viewing and managing requests |
| `src/domains/portal/` | Customer-facing portal |
| `tests/maintenance.test.ts` | Unit tests proving the workflow rules |
| `docs/BUSINESS-RULES.md` | Documentation of the maintenance flow |

---

## Key Code Files Explained

### 1. **`src/domains/maintenance/index.ts`**
The "brain" of maintenance requests. Contains:
- `canTransitionMaintenanceStatus()` → Pure function that checks if a status change is allowed
- `updateMaintenanceStatus()` → Actually changes the status and logs the audit trail
- `getMaintenanceRequestsPage()` → Fetches paginated requests from the database
- `getMaintenanceRequestById()` → Gets detailed info about one request (customer, appliance, photos, linked jobs)

### 2. **`src/app/desk/maintenance/actions.ts`**
Server action that handles the admin's request to change a status:
- Validates the user is OWNER or ADMIN
- Checks the status is valid
- Calls the domain function to update
- Revalidates the cache so the UI updates immediately

### 3. **`src/app/desk/maintenance/[id]/maintenance-detail-panel.tsx`**
Client component showing the status buttons:
- Displays the current status
- Shows buttons for allowed next statuses
- Handles the button click and calls the server action
- Shows error messages if something goes wrong

### 4. **`tests/maintenance.test.ts`**
Proves the workflow rules work correctly (tests that transitions follow the rules).

---

## Performance Issues & Solutions

### ⚠️ Issue 1: Database Query N+1 Problem
**Where:** `getMaintenanceRequestsPage()` includes nested relations (customer.user, appliance.applianceType, jobs, photos)

**Problem:** If you fetch 20 requests per page, and each request loads its customer, appliance, jobs, and photos, that's many database queries under the hood. As requests pile up, this gets slow.

**Solution:**
```typescript
// ✅ GOOD: Already optimized with include
export async function getMaintenanceRequestsPage(...) {
  return prisma.maintenanceRequest.findMany({
    include: {
      customer: { include: { user: { select: { name: true, email: true } } } },
      appliance: { include: { applianceType: true } },
      jobs: { orderBy: [{ scheduledAt: "desc" }] },
      photos: { orderBy: [{ createdAt: "asc" }] },
    },
    orderBy: [{ openedAt: "desc" }],
    skip,
    take: pageSize,
  });
}
```
**Status:** ✅ This is already well-optimized with Prisma's `include`.

---

### ⚠️ Issue 2: Multiple Cache Revalidations on Status Change
**Where:** `updateMaintenanceStatusAction()` revalidates 4 paths:
```typescript
revalidatePath("/desk/maintenance");
revalidatePath(`/desk/maintenance/${requestId}`);
revalidatePath("/desk/dashboard");
revalidatePath("/desk/activity");
```

**Problem:** Each revalidation clears the cache and forces re-renders. Doing 4 of them sequentially is slow.

**Solutions:**
1. **Batch revalidations** (if using Next.js 14.2+):
```typescript
revalidatePath("/desk/maintenance", "layout");  // Invalidate whole section
revalidatePath("/desk/dashboard", "layout");
```

2. **Only revalidate what's visible** — if the user is on the maintenance list, don't revalidate the dashboard.

3. **Use tags instead of paths** (Next.js 13.4.5+):
```typescript
// In getMaintenanceRequestsPage:
tags: ['maintenance-requests']

// In updateMaintenanceStatusAction:
revalidateTag('maintenance-requests');
```

---

### ⚠️ Issue 3: Duplicated Status Rules in Two Places
**Where:** 
- `src/domains/maintenance/index.ts` has `ALLOWED_TRANSITIONS` (server-side, enforced)
- `src/app/desk/maintenance/[id]/maintenance-detail-panel.tsx` has `ALLOWED_NEXT` (client-side, UI only)

**Problem:** If you need to change the rules, you must update both. Easy to forget and cause bugs.

**Solution:**
Export the rules from the domain and import them in the component:
```typescript
// domains/maintenance/index.ts
export const ALLOWED_TRANSITIONS: Record<MaintenanceStatus, MaintenanceStatus[]> = { ... }

// maintenance-detail-panel.tsx
import { ALLOWED_TRANSITIONS } from "@/domains/maintenance";
const nextStatuses = ALLOWED_TRANSITIONS[request.status];
```

---

### ⚠️ Issue 4: Status Type Guard Repeated
**Where:** `src/app/desk/maintenance/page.tsx` has a `isMaintenanceStatus()` function that manually checks all statuses:
```typescript
function isMaintenanceStatus(value: string | undefined): value is MaintenanceStatus {
  return (
    value === "SUBMITTED" ||
    value === "REVIEWING" ||
    // ... 4 more checks
  );
}
```

**Problem:** Fragile and verbose. Easy to miss a status when adding new ones.

**Solution:**
```typescript
const VALID_STATUSES = ["SUBMITTED", "REVIEWING", "SCHEDULED", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;

function isMaintenanceStatus(value: string | undefined): value is MaintenanceStatus {
  return VALID_STATUSES.includes(value as MaintenanceStatus);
}
```

Or use a library like `zod` for parsing and validating enums.

---

### ⚠️ Issue 5: Search Query Performance
**Where:** `src/domains/search/index.ts` runs 3 database queries in parallel:
```typescript
const [customers, appliances, leads] = await Promise.all([
  prisma.customer.findMany({ where: { ... } }),
  prisma.appliance.findMany({ where: { ... } }),
  prisma.lead.findMany({ where: { ... } }),
]);
```

**Problem:** Each query uses `contains` with `insensitive` mode. On large tables (thousands of records), this is slow because PostgreSQL can't use indexes efficiently for case-insensitive substring matching.

**Solution:**
1. **Add database indexes** on the searchable columns with `COLLATE "C"` (case-sensitive, faster):
```prisma
model Customer {
  user: User
  companyName String @db.Collate("C")  // Index-friendly
}
```

2. **Limit results** to the first 10 matches:
```typescript
prisma.customer.findMany({
  where: { ... },
  take: 10,  // Don't fetch everything
})
```

3. **Use full-text search** if Postgres supports it (Neon does):
```sql
-- Prisma doesn't expose this directly, but you can use Prisma's raw query
prisma.$queryRaw`SELECT * FROM Customer WHERE to_tsvector(name) @@ plainto_tsquery(${query})`
```

---

### ⚠️ Issue 6: No Pagination on Related Records
**Where:** `getMaintenanceRequestById()` loads all photos and jobs without pagination:
```typescript
photos: { orderBy: [{ createdAt: "asc" }] },  // ALL photos loaded
jobs: { orderBy: [{ scheduledAt: "desc" }] },  // ALL jobs loaded
```

**Problem:** If a maintenance request has 100 photos or 50 related jobs, they're all loaded into memory even if the UI only shows 5.

**Solution:**
Load related records separately with pagination in the detail view:
```typescript
// In the detail page component
const request = await getMaintenanceRequestById(id);
const recentPhotos = await getMaintenancePhotos(id, { take: 5 });
const recentJobs = await getMaintenanceJobs(id, { take: 5 });

return (
  <>
    {/* Show first 5 photos with a "View more" link */}
    {recentPhotos.map(photo => ...)}
    {recentPhotos.length === 5 && <a href="...">View all photos</a>}
  </>
);
```

---

### ⚠️ Issue 7: Role Checking on Every Request
**Where:** Every server action and data fetch calls `requireRole()`:
```typescript
export async function updateMaintenanceStatusAction(requestId: string, status: string) {
  const session = await requireRole("OWNER", "ADMIN");  // ← Called here
  // ...
}
```

**Problem:** This function likely queries the session/database every time. On high-traffic pages, this adds latency.

**Solution:**
Cache the session in Next.js middleware or use JWTs to avoid database calls:
```typescript
// middleware.ts
export function middleware(request: NextRequest) {
  const session = verifySessionToken(request.cookies.get('session')?.value);
  request.headers.set('x-user-role', session.user.role);
}
```

Then use the header instead of calling `requireRole()` every time.

---

## Summary Table: Issues & Fixes

| Issue | Severity | Fix |
|-------|----------|-----|
| Revalidating 4 paths on status change | Medium | Use tag-based revalidation |
| Duplicated status rules in 2 files | Medium | Export from domain, import in component |
| Repeated status type guard | Low | Use constant array + includes() |
| Case-insensitive search is slow | Medium | Add indexes, limit results, use full-text search |
| All photos/jobs loaded without pagination | Medium | Paginate related records separately |
| Role checking on every request | Low-Medium | Cache session or use JWT |

---

## Getting Started: A Developer's Guide

1. **Set up the database:** Connect to Neon PostgreSQL via `DATABASE_URL`
2. **Run migrations:** `npx prisma migrate dev`
3. **Understand the flow:** Read `docs/BUSINESS-RULES.md` → read `src/domains/maintenance/index.ts` → read the UI in `src/app/desk/maintenance/`
4. **Run tests:** `npm test` to ensure your changes don't break the workflow rules
5. **Make changes:** Add features by modifying the domain logic and UI layer separately
6. **Check the audit log:** Every status change is tracked in the `auditLog` table

---

## Key Takeaway

This is a **clean, well-structured** maintenance request management system. The main opportunities for performance improvement are:
- Consolidating cache invalidation
- Reducing database query redundancy
- Optimizing search queries
- Applying pagination to related records

The code is maintainable, tested, and follows best practices for a Next.js app!
