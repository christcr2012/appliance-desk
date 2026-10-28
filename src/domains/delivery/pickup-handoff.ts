/**
 * ZONE-1 (Codex finding on PR #604): "I'll pick it up". A signed pickup rental gets ONE hand-over job instead of a
 * delivery visit. It is a DELIVERY-type job marked customerPickupHandoff, so completing it runs exactly the normal
 * delivered path (first delivered date, continuity, Rented status, custody and the recurring-billing hand-off) — but no
 * truck goes anywhere: it never shows on the driver's route or the vehicle trip log, never sends a day-of visit
 * reminder, never counts as a delivery for city license rules, and never records Colorado's retail delivery fee
 * (that fee is for deliveries by motor vehicle, not an item the customer collects).
 */

/** "Washer and Dryer", "Washer, Dryer and Freezer"; "the rented appliances" when none are set aside yet. */
export function handoffItemsText(names: readonly string[]): string {
  const clean = [...new Set(names.map((name) => name.replace(/\s+/g, " ").trim()).filter(Boolean))];
  if (!clean.length) return "the rented appliances";
  if (clean.length === 1) return clean[0]!;
  return `${clean.slice(0, -1).join(", ")} and ${clean.at(-1)}`;
}

/** The To do / job words. Never "Schedule delivery". */
export function pickupHandoffTitle(names: readonly string[], customerName: string): string {
  return `Customer pickup: hand over ${handoffItemsText(names)} to ${customerName}`;
}

export const PICKUP_HANDOFF_DETAIL =
  "This rental was signed and the customer is picking it up. When they collect it, open this hand-over, mark each item Handed over and save: that starts the rental and its monthly billing. Confirm the signing payment first.";

export const PICKUP_HANDOFF_NOTE =
  "Agreement signed. Customer pickup (no delivery trip): when the customer collects it, mark each item Handed over to start the rental and its billing. Confirm the signing payment first.";

/** The kind of appliance on each unit set aside for the agreement's lines, else the rental line names. Pure. */
export function handoffNamesFromLines(lines: ReadonlyArray<{ label: string;
  assignments?: ReadonlyArray<{ appliance: { applianceType: { name: string } } }> }>): string[] {
  const assigned = lines.flatMap((line) => (line.assignments ?? []).map((row) => row.appliance.applianceType.name));
  return assigned.length ? assigned : lines.map((line) => line.label);
}
