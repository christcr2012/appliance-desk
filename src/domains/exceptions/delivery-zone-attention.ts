import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { readZoneSnapshot } from "@/domains/delivery/snapshot";
import type { ExceptionItem } from "./rules";

type Rows = { rows: ExceptionItem[]; total: number };

const OPEN = ["DRAFT", "CHANGES_REQUESTED", "SENT", "VIEWED", "APPROVED", "CONVERTED"] as const;

/**
 * ZONE-1: To do items from estimates' delivery zones (owner and admins only). Read-only; each clears by itself:
 *  - "Confirm the delivery zone for {address}": the lookup couldn't place the address (clears when staff type the miles
 *    or a new check finds it). Not for converted estimates (the agreement's own screens take over).
 *  - "Arrange pickup with {name}": the customer chose to pick it up (clears when staff record the arrangement).
 */
export async function listDeliveryZoneAttention(limit: number): Promise<{ unknown: Rows; pickups: Rows }> {
  await requireRole("OWNER", "ADMIN");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("A bounded task limit is required.");
  const estimates = await prisma.estimate.findMany({
    where: { status: { in: [...OPEN] }, deliveryZoneSnapshotAt: { not: null } },
    select: {
      id: true, status: true, estimateNumber: true, updatedAt: true, deliveryZoneSnapshotAt: true,
      deliveryZoneSnapshot: true,
      customer: { select: { companyName: true, user: { select: { name: true, email: true } } } },
      lead: { select: { contactName: true } },
      lineItems: { select: { serviceAddress: { select: { id: true, line1: true, city: true } } } },
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: 300,
  });
  const unknown: ExceptionItem[] = [];
  const pickups: ExceptionItem[] = [];
  for (const estimate of estimates) {
    const snapshot = readZoneSnapshot(estimate.deliveryZoneSnapshot);
    if (!snapshot) continue;
    const name = estimate.customer?.companyName || estimate.customer?.user.name || estimate.customer?.user.email ||
      estimate.lead?.contactName || `estimate #${estimate.estimateNumber}`;
    const href = "/desk/estimates/" + encodeURIComponent(estimate.id) + "#delivery-zone";
    const since = estimate.deliveryZoneSnapshotAt ?? estimate.updatedAt;
    for (const location of snapshot.locations) {
      const address = estimate.lineItems.map((line) => line.serviceAddress)
        .find((row) => row?.id === location.serviceAddressId);
      // An address whose lines were removed is no longer part of the estimate.
      if (!address) continue;
      const label = address ? `${address.line1}, ${address.city}` : `estimate #${estimate.estimateNumber}`;
      if (location.zone === "UNKNOWN" && estimate.status !== "CONVERTED") {
        unknown.push({
          category: "DELIVERY_ZONE_UNKNOWN", severity: "medium",
          title: "Confirm the delivery zone for " + label,
          detail: "The address lookup couldn't place it on the map. Type the miles so the estimate shows the right delivery price.",
          href, since,
          primaryAction: { label: "Confirm zone", href },
        });
      } else if (location.choice === "CUSTOMER_PICKUP" && !location.pickupArranged) {
        pickups.push({
          category: "PICKUP_TO_ARRANGE", severity: "medium",
          title: "Arrange pickup with " + name,
          detail: `Estimate #${estimate.estimateNumber}: they'll pick up the appliance (${label}). Agree on a date, time and place.`,
          href, since,
          primaryAction: { label: "Record pickup plan", href },
        });
      }
    }
  }
  return {
    unknown: { rows: unknown.slice(0, limit), total: unknown.length },
    pickups: { rows: pickups.slice(0, limit), total: pickups.length },
  };
}
