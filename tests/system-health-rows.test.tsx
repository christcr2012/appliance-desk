// MCP-1 spec 1 and 4: one fake System health row per state renders its label next to its colour, with plain help and
// never any raw error text.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { HealthLegend, HealthRow, helpFor, type HealthRowData } from "@/app/desk/automations/health-row";
import { HEALTH_PRESENTATION, HEALTH_STATES, type HealthState } from "@/domains/automation/health-states";
import { FAILURE_CODES } from "@/domains/automation/failures";
import { PILL_TONE } from "@/components/kit";

vi.mock("next/navigation", () => import("./kit/kit-test-env"));
afterEach(cleanup);

const row = (state: HealthState, over: Partial<HealthRowData> = {}): HealthRowData => ({
  ruleKey: "rule-" + state, label: "Job " + state, explanation: "A synthetic job used only by this test.", state,
  dueAt: new Date("2026-10-20T09:00:00Z"), nextDueAt: new Date("2026-10-21T09:00:00Z"), graceMinutes: 120,
  missingEnv: state === "unconfigured" ? ["CRON_SECRET", "BLOB_READ_WRITE_TOKEN"] : [],
  lastSuccessAt: null,
  lastFailure: state === "failing" ? { at: new Date("2026-10-20T09:01:00Z"), code: "TIMEOUT", ref: "ref-0a1b2c3d4e" } : null,
  latest: state === "failing" ? { id: "run1", state: "FAILED", startedAt: new Date("2026-10-20T09:00:00Z"), code: "TIMEOUT", stage: "work", ref: "ref-0a1b2c3d4e" } : null,
  ...over,
});

describe("System health rows", () => {
  it.each(HEALTH_STATES)("renders the %s state's label with its colour and meaning", (state) => {
    render(<HealthRow row={row(state)} />);
    const look = HEALTH_PRESENTATION[state];
    const card = screen.getByTestId("health-row-rule-" + state);
    expect(card.dataset.state).toBe(state);
    const pill = within(card).getByText(look.label);
    expect(pill.dataset.tone).toBe(look.tone);
    for (const name of PILL_TONE[look.tone].split(" ")) expect(pill.className).toContain(name);
    expect(within(card).getByText(look.meaning)).toBeTruthy();
  });

  it("states that need something done show What to do and a link", () => {
    for (const state of HEALTH_STATES) {
      const help = helpFor(row(state));
      if (["failing", "late", "unknown", "unconfigured"].includes(state)) {
        expect(help, state).not.toBeNull();
        expect(help!.href.startsWith("/desk/")).toBe(true);
      } else {
        expect(help, state).toBeNull();
      }
    }
    render(<HealthRow row={row("failing")} />);
    expect(screen.getByText(FAILURE_CODES.TIMEOUT.explain)).toBeTruthy();
    expect(screen.getByText(FAILURE_CODES.TIMEOUT.next)).toBeTruthy();
    expect(screen.getByText("Reference ref-0a1b2c3d4e")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See problems the system found" })).toBeTruthy();
  });

  it("shows setting names only for Needs setup", () => {
    render(<HealthRow row={row("unconfigured")} />);
    expect(screen.getByText("Missing setting names: CRON_SECRET, BLOB_READ_WRITE_TOKEN.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open connection settings" })).toBeTruthy();
  });

  it("an old failure with no stored code says Not recorded instead of guessing", () => {
    render(<HealthRow row={row("failing", { latest: { id: "r", state: "FAILED", startedAt: new Date(), code: null, stage: null, ref: null }, lastFailure: { at: new Date(), code: null, ref: null } })} />);
    expect(screen.getByText(/^Not recorded/)).toBeTruthy();
  });

  it("the legend shows every state's label and meaning", () => {
    render(<HealthLegend />);
    for (const state of HEALTH_STATES) {
      const item = screen.getByTestId("health-legend-" + state);
      expect(within(item).getByText(HEALTH_PRESENTATION[state].label)).toBeTruthy();
      expect(within(item).getByText(HEALTH_PRESENTATION[state].meaning)).toBeTruthy();
    }
  });
});
