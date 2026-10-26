import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import {
  INBOX_GROUP,
  INBOX_GROUP_LABEL,
  INBOX_GROUP_ORDER,
  inboxActions,
  inboxEyebrow,
  inboxEyebrowTone,
  sortInbox,
} from "@/domains/exceptions/inbox";
import type { ExceptionCategory, ExceptionItem } from "@/domains/exceptions/rules";
import { readFileSync } from "node:fs";

const base = (over: Partial<ExceptionItem> = {}): ExceptionItem => ({
  category: "OVERDUE_JOB",
  severity: "medium",
  title: "Visit is overdue",
  detail: "Scheduled and not done.",
  href: "/desk/jobs/j1",
  since: new Date("2026-10-01T12:00:00Z"),
  ...over,
});

describe("Today inbox grouping (TODAY 3)", () => {
  it("puts every category in exactly one group", () => {
    const source = readFileSync("src/domains/exceptions/rules.ts", "utf8");
    const union = source.slice(source.indexOf("export type ExceptionCategory ="), source.indexOf("export type ExceptionSeverity"));
    const categories = [...union.matchAll(/"([A-Z_]+)"/g)].map((match) => match[1]) as ExceptionCategory[];
    expect(categories.length).toBeGreaterThan(40);
    expect(Object.keys(INBOX_GROUP).sort()).toEqual([...new Set(categories)].sort());
    for (const category of categories) expect(INBOX_GROUP_ORDER).toContain(INBOX_GROUP[category]);
    expect(INBOX_GROUP.PAST_DUE_INVOICE).toBe("money");
    expect(INBOX_GROUP.NEW_LEAD_CONTACT).toBe("sales");
    expect(INBOX_GROUP.SYSTEM_ISSUE).toBe("system");
    expect(INBOX_GROUP_LABEL.rentals).toBe("Rentals & visits");
  });

  it("sorts high first, then nearest deadline (none last), then longest waiting", () => {
    const items = [
      base({ title: "d", since: new Date("2026-09-01T00:00:00Z") }),
      base({ title: "c", dueOn: new Date("2026-10-30T00:00:00Z") }),
      base({ title: "b", severity: "high", since: new Date("2026-10-05T00:00:00Z") }),
      base({ title: "a", severity: "high", since: new Date("2026-10-02T00:00:00Z") }),
      base({ title: "e", dueOn: new Date("2026-10-26T00:00:00Z") }),
    ];
    expect(sortInbox(items).map((item) => item.title)).toEqual(["a", "b", "e", "c", "d"]);
  });

  it("eyebrow: Urgent · group · deadline, with tones", () => {
    const now = new Date("2026-10-25T18:00:00Z");
    const high = base({ category: "PAST_DUE_INVOICE", severity: "high", dueOn: new Date("2026-10-20T00:00:00Z"), dueDateOnly: true });
    expect(inboxEyebrow(high, now)).toBe("Urgent · Money · Overdue 5 days");
    expect(inboxEyebrowTone(high)).toBe("attention");
    const lead = base({ category: "NEW_LEAD_CONTACT" });
    expect(inboxEyebrow(lead, now)).toBe("Sales");
    expect(inboxEyebrowTone(lead)).toBe("info");
    expect(inboxEyebrowTone(base())).toBe("neutral");
  });

  it("actions: form primary for tax answers, Call or Email, Snooze only with a To do key", () => {
    const acknowledge = vi.fn();
    const tax = base({
      category: "SALES_TAX",
      action: { type: "ACK_TAX_SOURCE_CHANGE", id: "w1", version: "v1", label: "Mark reviewed" },
      sourceHref: "https://tax.colorado.gov/",
      todoKey: "k".repeat(64),
    });
    const withHandler = inboxActions(tax, { handlers: { acknowledgeTaxSource: acknowledge }, snoozeHref: (key) => `/desk/today?snooze=${key}` });
    expect(withHandler.actions[0]).toMatchObject({ kind: "form", label: "Mark reviewed", fields: { watchId: "w1", watchVersion: "v1" } });
    expect(withHandler.overflow.map((item) => item.label)).toEqual(["Snooze…", "Open", "View source"]);
    // Without the owner's handler the primary falls back to the link.
    expect(inboxActions(tax).actions[0]).toMatchObject({ kind: "link" });

    const phone = inboxActions(base({ contact: { phone: "970-555-0100", email: "a@example.test" } }));
    expect(phone.actions[1]).toEqual({ kind: "tel", label: "Call", phone: "970-555-0100" });
    const email = inboxActions(base({ contact: { email: "a@example.test" } }));
    expect(email.actions[1]).toEqual({ kind: "mailto", label: "Email", email: "a@example.test" });
    expect(inboxActions(base(), { snoozeHref: () => "/x" }).overflow).toEqual([]);
    expect(inboxActions(base({ todoKey: "k" }), { snoozeHref: () => "/x" }).overflow.map((i) => i.label)).toEqual(["Snooze…"]);
    expect(inboxActions(base({ todoKey: "k", sourceHref: "http://insecure.test" })).overflow).toEqual([]);
  });
});
