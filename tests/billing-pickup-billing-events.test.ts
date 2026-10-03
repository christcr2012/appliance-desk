import { beforeEach, describe, expect, it, vi } from "vitest";
import { businessDateEnd, businessDateFromKey } from "@/lib/business-date";

// What a completed pickup does to billing (src/domains/billing/pickup-billing-events.ts),
// run against a fake transaction: the agreement, settings and assignments are
// fixed and every write is captured.

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/stripe", () => ({ getStripeClient: () => ({}) }));

import { recordPickupBillingOnRemoval } from "@/domains/billing/pickup-billing-events";

const day = (key: string) => businessDateFromKey(key)!;
const afternoon = (key: string) => new Date(day(key).getTime() + 15.5 * 3_600_000);

type Writes = {
  invoices: unknown[];
  credits: unknown[];
  assignmentUpdates: unknown[];
  audits: unknown[];
  locks: number;
};

function fakeTx(input: {
  agreement: Record<string, unknown> | null;
  settings?: Record<string, unknown> | null;
  assignments: Array<Record<string, unknown>>;
}) {
  const writes: Writes = { invoices: [], credits: [], assignmentUpdates: [], audits: [], locks: 0 };
  const tx = {
    rentalAgreement: { findUnique: vi.fn(async () => input.agreement) },
    businessSettings: { findUnique: vi.fn(async () => input.settings ?? null) },
    applianceAssignment: {
      findMany: vi.fn(async () => input.assignments),
      update: vi.fn(async (args: unknown) => {
        writes.assignmentUpdates.push(args);
        return {};
      }),
    },
    invoice: {
      create: vi.fn(async (args: { data: unknown }) => {
        writes.invoices.push(args.data);
        return { id: `inv-${writes.invoices.length}` };
      }),
    },
    customerCredit: {
      create: vi.fn(async (args: { data: unknown }) => {
        writes.credits.push(args.data);
        return { id: `credit-${writes.credits.length}` };
      }),
    },
    auditLog: {
      create: vi.fn(async (args: { data: unknown }) => {
        writes.audits.push(args.data);
        return {};
      }),
    },
    $queryRaw: vi.fn(async () => {
      writes.locks += 1;
      return [{ id: "cust-1" }];
    }),
  };
  return { tx, writes };
}

const line = (id: string, monthlyPriceCents: number, applianceIds: string[]) => ({
  id,
  monthlyPriceCents,
  assignments: applianceIds.map((applianceId) => ({ applianceId })),
});

const assignment = (
  id: string,
  applianceId: string,
  rentalLine: ReturnType<typeof line>,
  name: string,
  unassignedAt: Date | null = null,
) => ({
  id,
  applianceId,
  unassignedAt,
  rentalLine,
  appliance: { assetNumber: applianceId.toUpperCase(), applianceType: { name } },
});

beforeEach(() => vi.clearAllMocks());

describe("late return on an ended agreement", () => {
  const ended = {
    id: "agr-1",
    customerId: "cust-1",
    status: "ENDED",
    endDate: businessDateEnd("2026-10-10"),
    billingStartedAt: afternoon("2026-03-10"),
    paidInFullInAdvance: false,
    taxRateMilliPercent: 7_375,
  };

  it("bills 3 late days per item on one open invoice, each as its own labeled line, with the agreement's tax", async () => {
    const washerLine = line("line-w", 4_500, ["w1"]);
    const { tx, writes } = fakeTx({
      agreement: ended,
      assignments: [assignment("as-1", "w1", washerLine, "Washer", day("2026-10-10"))],
    });
    const result = await recordPickupBillingOnRemoval(tx as never, {
      userId: "owner",
      jobId: "job-1",
      agreementId: "agr-1",
      applianceIds: ["w1"],
      completedAt: afternoon("2026-10-14"),
    });

    expect(result.lateReturnInvoiceId).toBe("inv-1");
    expect(writes.locks).toBe(1); // the customer's ledger was locked first
    const invoice = writes.invoices[0] as {
      status: string;
      subtotalCents: number;
      taxCents: number;
      amountDueCents: number;
      lineItems: { createMany: { data: Array<{ kind: string; description: string; amountCents: number; rentalLineId: string | null }> } };
    };
    expect(invoice.status).toBe("OPEN");
    expect(invoice.subtotalCents).toBe(450);
    expect(invoice.taxCents).toBe(33); // 7.375% of $4.50 = $0.3319 → $0.33
    expect(invoice.amountDueCents).toBe(483);
    expect(invoice.lineItems.createMany.data).toEqual([
      { kind: "LATE_RETURN", description: "Late return – Washer #W1 – 3 days", amountCents: 450, quantity: 1, rentalLineId: "line-w" },
      { kind: "TAX", description: "Sales tax", amountCents: 33, quantity: 1, rentalLineId: null },
    ]);
    expect(result.lateReturnCents).toBe(483);
    expect(writes.credits).toHaveLength(0);
    expect((writes.audits[0] as { action: string }).action).toBe("billing.late_return_invoiced");
  });

  it("bills nothing and writes no invoice for an on-time pickup", async () => {
    const { tx, writes } = fakeTx({
      agreement: ended,
      assignments: [assignment("as-1", "w1", line("line-w", 4_500, ["w1"]), "Washer", day("2026-10-10"))],
    });
    const result = await recordPickupBillingOnRemoval(tx as never, {
      userId: "owner",
      jobId: "job-1",
      agreementId: "agr-1",
      applianceIds: ["w1"],
      completedAt: afternoon("2026-10-11"),
    });
    expect(result.lateReturnInvoiceId).toBeNull();
    expect(writes.invoices).toHaveLength(0);
    expect(writes.locks).toBe(0);
    expect(result.notes[0]).toMatch(/on time/);
  });

  it("does nothing when the job took no appliances", async () => {
    const { tx, writes } = fakeTx({ agreement: ended, assignments: [] });
    const result = await recordPickupBillingOnRemoval(tx as never, {
      userId: "owner",
      jobId: "job-1",
      agreementId: "agr-1",
      applianceIds: [],
      completedAt: afternoon("2026-10-14"),
    });
    expect(result.lateReturnInvoiceId).toBeNull();
    expect(tx.rentalAgreement.findUnique).not.toHaveBeenCalled();
    expect(writes.invoices).toHaveLength(0);
  });
});

describe("early return on an active 2-item agreement", () => {
  // Billing started Oct 1, so the billed month is Oct 1 – Oct 31. The dryer of a
  // $60 washer+dryer set comes back Oct 22: 10 unused days at $30 ÷ 30 = $10.
  const active = {
    id: "agr-2",
    customerId: "cust-1",
    status: "ACTIVE",
    endDate: null,
    billingStartedAt: afternoon("2026-10-01"),
    paidInFullInAdvance: false,
    taxRateMilliPercent: 0,
  };
  const setLine = line("line-set", 6_000, ["w1", "d1"]);

  it("releases the returned item and records a labeled credit for its unused days; the washer keeps billing", async () => {
    const { tx, writes } = fakeTx({
      agreement: active,
      assignments: [assignment("as-d", "d1", setLine, "Dryer")],
    });
    const result = await recordPickupBillingOnRemoval(tx as never, {
      userId: "owner",
      jobId: "job-2",
      agreementId: "agr-2",
      applianceIds: ["d1"],
      completedAt: afternoon("2026-10-22"),
    });

    expect(writes.assignmentUpdates).toEqual([
      { where: { id: "as-d" }, data: { unassignedAt: afternoon("2026-10-22"), unassignReason: "Returned early" } },
    ]);
    expect(result.earlyReturnCreditIds).toEqual(["credit-1"]);
    expect(result.earlyReturnCents).toBe(1_000);
    expect(writes.credits[0]).toMatchObject({
      customerId: "cust-1",
      amountCents: 1_000,
      remainingCents: 1_000,
      reason: "Credit – Dryer #D1 returned early – 10 days",
      sourceType: "EARLY_RETURN",
      sourceId: "job-2:d1",
      side: "CUSTOMER",
      authorizedByUserId: "owner",
    });
    expect(writes.invoices).toHaveLength(0);
    expect((writes.audits[0] as { action: string }).action).toBe("billing.early_return_credit");
  });

  it("gives no automatic credit when billing never started or the rental was prepaid", async () => {
    for (const agreement of [
      { ...active, billingStartedAt: null },
      { ...active, paidInFullInAdvance: true },
    ]) {
      const { tx, writes } = fakeTx({ agreement, assignments: [assignment("as-d", "d1", setLine, "Dryer")] });
      const result = await recordPickupBillingOnRemoval(tx as never, {
        userId: "owner",
        jobId: "job-2",
        agreementId: "agr-2",
        applianceIds: ["d1"],
        completedAt: afternoon("2026-10-22"),
      });
      expect(writes.assignmentUpdates).toHaveLength(1); // still released from the agreement
      expect(writes.credits).toHaveLength(0);
      expect(result.earlyReturnCreditIds).toEqual([]);
      expect(result.notes[0]).toMatch(/no (credit|automatic credit)/);
    }
  });

  it("uses the owner's saved proration basis and pickup-day switch", async () => {
    const { tx, writes } = fakeTx({
      agreement: active,
      settings: { earlyReturnProrationBasis: "ACTUAL_DAYS_IN_MONTH", pickupDayNotBilled: false },
      assignments: [assignment("as-d", "d1", setLine, "Dryer")],
    });
    await recordPickupBillingOnRemoval(tx as never, {
      userId: "owner",
      jobId: "job-2",
      agreementId: "agr-2",
      applianceIds: ["d1"],
      completedAt: afternoon("2026-10-22"),
    });
    // 9 unused days (Oct 23–31) at $30 ÷ 31 → $8.71
    expect(writes.credits[0]).toMatchObject({
      amountCents: 871,
      reason: "Credit – Dryer #D1 returned early – 9 days",
    });
  });
});
