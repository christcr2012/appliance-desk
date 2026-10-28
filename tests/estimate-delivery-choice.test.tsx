// ZONE-1 (Codex finding on PR #604): the customer's delivery panel shows the charge approval and signing require, so an
// owner-recorded driving-route exception never shows "free" above a quote that charges for delivery.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/app/estimate/[id]/zone-actions", () => ({ chooseDeliveryAction: async () => undefined }));
import { EstimateDeliveryChoice } from "@/app/estimate/[id]/delivery-choice";
import { buildZoneLocation } from "@/domains/delivery/snapshot";
import { startingZoneSettings, STARTING_CENTER } from "@/domains/delivery/zone";

const settings = startingZoneSettings();
const location = (choice: "DELIVER" | "CUSTOMER_PICKUP") => ({
  ...buildZoneLocation({ serviceAddressId: "addr_1", settings, now: new Date("2026-10-27T18:00:00Z"),
    position: { status: "FOUND", point: { lat: STARTING_CENTER.lat + 12 / 69, lon: STARTING_CENTER.lon } } }),
  choice,
});
const render = (choice: "DELIVER" | "CUSTOMER_PICKUP", charges?: Record<string, { deliverCents: number | null; routeException: boolean }>) =>
  renderToStaticMarkup(EstimateDeliveryChoice({ estimateId: "est_1", status: "SENT",
    snapshot: { version: 1, locations: [location(choice)] }, addresses: [{ id: "addr_1", label: "1 Main St, Greeley" }], charges }));

describe("customer delivery panel", () => {
  it("without an exception shows the Local zone's free delivery", () => {
    const html = render("DELIVER", { addr_1: { deliverCents: 0, routeException: false } });
    expect(html).toContain(": free delivery");
    expect(html).toContain("You chose delivery (Free)");
    expect(html).not.toContain("driving route");
  });
  it("with a route exception shows its price in the zone line and the chosen-delivery line", () => {
    const html = render("DELIVER", { addr_1: { deliverCents: 7500, routeException: true } });
    expect(html).toContain("but because of the driving route to your address, delivery is $75");
    expect(html).toContain("You chose delivery ($75)");
    expect(html).not.toContain(": free delivery");
    expect(html).not.toContain("(Free)");
  });
  it("offers the exception's price on the Deliver it button when the customer chose pickup", () => {
    const html = render("CUSTOMER_PICKUP", { addr_1: { deliverCents: 7500, routeException: true } });
    expect(html).toContain("Deliver it ($75)");
  });
  it("shows 'price to be confirmed' when the charge can't be worked out", () => {
    const html = render("DELIVER", { addr_1: { deliverCents: null, routeException: false } });
    expect(html).toContain("You chose delivery (price to be confirmed)");
    expect(html).toContain("We&#x27;ll confirm your delivery price.");
    expect(html).not.toContain(": free delivery");
  });
});
