import { describe, expect, it, vi } from "vitest";

const switches = vi.fn();
const health = vi.fn();
const waiting = vi.fn();
vi.mock("@/domains/settings/switches", () => ({ listSwitches: () => switches() }));
vi.mock("@/domains/automation/health", () => ({ getAutomationHealth: () => health() }));
vi.mock("@/domains/approvals", () => ({ countWaitingApprovals: () => waiting() }));

import { loadReadiness } from "@/domains/control-center/readiness";

const row = (id: string, on: boolean | null, state: string) => ({ id, name: id, on, state, lastChange: null, changeAt: "/x" });

function happy() {
  switches.mockResolvedValue([row("customer-email", false, "Off"), row("email-provider", null, "Not fully configured; sending unavailable"), row("sms", false, "Switched off"), row("payments", null, "Test key configured")]);
  health.mockResolvedValue([{ state: "healthy" }]);
  waiting.mockResolvedValue(0);
}

describe("Manage my business: readiness cards", () => {
  it("never shows a green check for things a setting cannot prove", async () => {
    happy();
    switches.mockResolvedValue([row("customer-email", true, "On"), row("email-provider", null, "Configured; delivery still requires verification"), row("sms", false, "Off"), row("payments", null, "Live key configured; payment processing still requires verification")]);
    const cards = await loadReadiness("OWNER");
    expect(cards.find((c) => c.id === "customer-messages")!.state).toBe("WAITING_FOR_OWNER");
    expect(cards.find((c) => c.id === "card-payments")!.state).toBe("WAITING_FOR_OWNER");
  });
  it("test keys and missing keys need attention; both messaging switches off reads as off", async () => {
    happy();
    const cards = await loadReadiness("OWNER");
    expect(cards.find((c) => c.id === "card-payments")!.state).toBe("NEEDS_SETUP");
    expect(cards.find((c) => c.id === "customer-messages")!.state).toBe("OFF");
  });
  it("one failing source marks only that card unavailable", async () => {
    happy();
    health.mockRejectedValue(new Error("database said: secret detail"));
    const cards = await loadReadiness("OWNER");
    const jobs = cards.find((c) => c.id === "background-jobs")!;
    expect(jobs.state).toBe("UNAVAILABLE");
    expect(jobs.detail).not.toMatch(/secret detail/);
    expect(cards.find((c) => c.id === "card-payments")!.state).toBe("NEEDS_SETUP");
  });
  it("reports failing jobs and waiting approvals; admins never get the approvals card", async () => {
    happy();
    health.mockResolvedValue([{ state: "failing" }, { state: "healthy" }]);
    waiting.mockResolvedValue(2);
    const owner = await loadReadiness("OWNER");
    expect(owner.find((c) => c.id === "background-jobs")!.state).toBe("NEEDS_SETUP");
    expect(owner.find((c) => c.id === "approvals")).toMatchObject({ state: "WAITING_FOR_OWNER", detail: expect.stringContaining("2 requests") });
    const admin = await loadReadiness("ADMIN");
    expect(admin.some((c) => c.id === "approvals")).toBe(false);
    expect(waiting).toHaveBeenCalledTimes(1);
  });
});
