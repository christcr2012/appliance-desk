import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: { invoice: { fields: { amountPaidCents: "FIELD:amountPaidCents" } } } }));
import { billOwedWhere, billPill, billPillInfo, billTabWhere, pastDueInvoiceWhere, payPathFor } from "@/domains/billing/bill-status";

const NOT_CONFIRMING = { bankPaymentsInFlight: { none: { clearedAt: null } } };
const CONFIRMING = { bankPaymentsInFlight: { some: { clearedAt: null } } };
const OWED = { status: { in: ["OPEN", "PARTIALLY_PAID", "DELINQUENT", "FAILED"] }, amountDueCents: { gt: "FIELD:amountPaidCents" } };
const OPEN = { ...OWED, ...NOT_CONFIRMING };
// 2026-10-25 is MDT (UTC-6); 2026-11-02 is MST (UTC-7, after the Nov 1 change).
const at = (iso: string) => new Date(iso);

describe("bill tab filters (MONEY-BILLS 2)", () => {
  it("builds each tab's where", () => {
    const now = at("2026-10-25T18:00:00Z");
    expect(billTabWhere("open", now)).toEqual(OPEN);
    expect(billTabWhere("past-due", now)).toEqual({ ...OPEN, dueDate: { lt: at("2026-10-25T06:00:00Z") } });
    expect(billTabWhere("paid", now)).toEqual({ status: "PAID" });
    expect(billTabWhere("closed", now)).toEqual({ status: { in: ["VOID", "WRITTEN_OFF", "REFUNDED"] } });
    expect(billTabWhere("drafts", now)).toEqual({ status: "DRAFT" });
    expect(billTabWhere("being-confirmed", now)).toEqual({ ...OWED, ...CONFIRMING });
    // What the customer owes never drops a bill just because the bank is confirming a payment.
    expect(billOwedWhere(now)).toEqual(OWED);
    expect(pastDueInvoiceWhere(now)).toEqual(billTabWhere("past-due", now));
  });

  it("a bill whose bank payment is being confirmed is never open-tab or past-due work", () => {
    const now = at("2026-10-25T18:00:00Z");
    expect(billTabWhere("open", now)).toMatchObject(NOT_CONFIRMING);
    expect(pastDueInvoiceWhere(now)).toMatchObject(NOT_CONFIRMING);
    expect(billTabWhere("being-confirmed", now)).toMatchObject(CONFIRMING);
  });

  it("past due starts at Colorado midnight, across the November DST change", () => {
    expect(pastDueInvoiceWhere(at("2026-11-02T07:30:00Z")).dueDate).toEqual({ lt: at("2026-11-02T07:00:00Z") });
    expect(pastDueInvoiceWhere(at("2026-03-09T12:00:00Z")).dueDate).toEqual({ lt: at("2026-03-09T06:00:00Z") });
  });
});

describe("being confirmed pill", () => {
  it("says Being confirmed instead of late, and explains it", () => {
    const now = at("2026-10-25T18:00:00Z");
    const late = { status: "OPEN" as const, dueDate: at("2026-10-01T06:00:00Z"), amountDueCents: 7000, amountPaidCents: 0 };
    expect(billPill(late, now).label).toMatch(/days late/);
    expect(billPill({ ...late, beingConfirmed: true }, now)).toEqual({ label: "Being confirmed", tone: "info" });
    expect(billPillInfo("OPEN", true)).toBe("bill-processing");
    expect(billPillInfo("OPEN", false)).toBeUndefined();
  });
});

describe("bill pill words", () => {
  const bill = (over: Partial<Parameters<typeof billPill>[0]>) => ({
    status: "OPEN" as const,
    dueDate: at("2026-10-25T06:00:00Z"),
    amountDueCents: 7000,
    amountPaidCents: 0,
    ...over,
  });
  it.each([
    [{ status: "PAID" as const, amountPaidCents: 7000 }, "Paid", "good"],
    [{ status: "VOID" as const }, "Cancelled", "neutral"],
    [{ status: "WRITTEN_OFF" as const }, "Given up", "neutral"],
    [{ status: "REFUNDED" as const }, "Refunded", "neutral"],
    [{ status: "DRAFT" as const }, "Draft", "neutral"],
    [{ status: "FAILED" as const }, "Check this bill", "attention"],
    [{ dueDate: at("2026-10-20T06:00:00Z") }, "5 days late", "attention"],
    [{ dueDate: at("2026-10-24T06:00:00Z") }, "1 day late", "attention"],
    [{ dueDate: at("2026-10-30T06:00:00Z") }, "Due Oct 30", "neutral"],
    [{ dueDate: null }, "Open", "neutral"],
  ])("%o → %s", (over, label, tone) => {
    expect(billPill(bill(over), at("2026-10-25T18:00:00Z"))).toEqual({ label, tone });
  });

  it("'Due today' holds from 00:01 to 23:59 Colorado time, and a bill paid on its due date says Paid", () => {
    const due = bill({ dueDate: at("2026-10-25T06:00:00Z") });
    expect(billPill(due, at("2026-10-25T06:01:00Z")).label).toBe("Due today"); // 00:01 MDT
    expect(billPill(due, at("2026-10-26T05:59:00Z")).label).toBe("Due today"); // 23:59 MDT
    expect(billPill(due, at("2026-10-26T06:01:00Z")).label).toBe("1 day late");
    expect(billPill({ ...due, status: "PAID", amountPaidCents: 7000 }, at("2026-10-25T12:00:00Z")).label).toBe("Paid");
  });
});

describe("how a bill is paid from the list", () => {
  it.each([
    [{ status: "PAID" as const, owedCents: 0, stripeInvoiceId: "in_x", saleKind: null }, null],
    [{ status: "OPEN" as const, owedCents: 0, stripeInvoiceId: "in_x", saleKind: null }, null],
    [{ status: "FAILED" as const, owedCents: 7000, stripeInvoiceId: "in_x", saleKind: null }, null],
    [{ status: "DELINQUENT" as const, owedCents: 7000, stripeInvoiceId: "in_x", saleKind: null }, "STRIPE_LINK"],
    [{ status: "OPEN" as const, owedCents: 7000, stripeInvoiceId: null, saleKind: "SHOP_SALE" }, "SHOP_CARD"],
    [{ status: "PARTIALLY_PAID" as const, owedCents: 100, stripeInvoiceId: null, saleKind: null }, "MANUAL_ONLY"],
  ])("%o → %s", (input, path) => {
    expect(payPathFor(input)).toBe(path);
  });

  it("no source file ever sets an invoice to FAILED (a failed payment sets DELINQUENT)", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) files.push(path);
      }
    };
    walk("src");
    const offenders = files.filter((file) => /status:\s*["']FAILED["']/.test(readFileSync(file, "utf8")) && /invoice/i.test(readFileSync(file, "utf8")))
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        return /invoice\.(update|updateMany|create|upsert)\([\s\S]{0,400}status:\s*["']FAILED["']/.test(text);
      });
    expect(offenders).toEqual([]);
  });
});
