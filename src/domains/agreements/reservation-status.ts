import type { RentalAgreementStatus } from "@prisma/client";

// Pure, zero-database-import reservation-staleness check (Phase 6A item
// 6 — see docs/DECISIONS.md). Split out from src/domains/agreements/
// index.ts specifically so client components (the agreement detail
// panel, the agreements list) can import it directly without dragging
// that module's top-level `import { prisma } from "@/lib/prisma"` into
// the browser bundle — the exact client-bundle-Prisma-leak bug this
// project has been bitten by before (see AGENTS.md). Mirrors the same
// split already used for src/domains/pricing/money.ts and
// src/domains/leads/schema.ts. src/domains/agreements/index.ts
// re-exports this for server callers, so there's one implementation,
// not two to keep in sync.

/** An agreement is only ever "stale" while its appliances are merely
 * reserved, not yet actually rented — once it's ACTIVE (or ENDED/
 * CANCELLED), the hold concept no longer applies. */
export function isReservationStale(
  status: RentalAgreementStatus,
  reservationExpiresAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (status !== "DRAFT" && status !== "AWAITING_SIGNATURE") {
    return false;
  }
  if (!reservationExpiresAt) {
    return false;
  }
  return reservationExpiresAt.getTime() < now.getTime();
}
