import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Simulated Stripe: no network, no SDK. Every call is recorded by dotted path
// so the test can prove the drift workbench only ever READS from Stripe.
const stripeSim = vi.hoisted(() => ({
  calls: [] as string[],
  subscriptions: new Map<string, string>(), // id -> status, or "missing"
  customers: new Map<string, "ok" | "deleted" | "missing">(),
  clientUnavailable: false,
}));

vi.mock("@/lib/stripe", () => {
  const missing = () =>
    Object.assign(new Error("No such resource"), {
      type: "StripeInvalidRequestError",
      code: "resource_missing",
    });
  const handlers: Record<string, (id: string) => unknown> = {
    "subscriptions.retrieve": (id) => {
      const status = stripeSim.subscriptions.get(id);
      if (!status || status === "missing") throw missing();
      return { id, status };
    },
    "customers.retrieve": (id) => {
      const state = stripeSim.customers.get(id);
      if (!state || state === "missing") throw missing();
      return state === "deleted" ? { id, deleted: true } : { id, deleted: undefined };
    },
  };
  const client = new Proxy(
    {},
    {
      get: (_t, resource: string) =>
        new Proxy(
          {},
          {
            get: (_r, method: string) => async (...args: unknown[]) => {
              const path = `${resource}.${method}`;
              stripeSim.calls.push(path);
              const handler = handlers[path];
              if (!handler) throw new Error(`Unexpected Stripe call in drift detection: ${path}`);
              return handler(String(args[0]));
            },
          },
        ),
    },
  );
  return {
    getStripeClient: () => {
      if (stripeSim.clientUnavailable) throw new Error("STRIPE_SECRET_KEY is not set.");
      return client;
    },
  };
});

import { prisma } from "@/lib/prisma";
import { detectDrift, type DriftRow } from "@/domains/billing/reconciliation";

// Only ever run against CI's disposable local Postgres.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("billing drift detection (read-only) in disposable Postgres", () => {
  const tag = randomUUID().replace(/-/g, "").slice(0, 16);
  const ids = {
    users: [] as string[],
    customers: {} as Record<string, string>,
    agreements: {} as Record<string, string>,
    invoices: {} as Record<string, string>,
    payments: {} as Record<string, string>,
    receipts: [] as string[],
    ops: {} as Record<string, string>,
    credits: [] as string[],
    audits: [] as string[],
    addresses: [] as string[],
  };
  const opKeys: string[] = [];

  async function makeCustomer(name: string, stripeCustomerId: string | null) {
    const user = await prisma.user.create({
      data: { email: `drift-${tag}-${name}@example.test`, name: `drift ${name}` },
    });
    ids.users.push(user.id);
    const customer = await prisma.customer.create({
      data: {
        userId: user.id,
        stripeCustomerId,
        referralCode: `DR${tag}${name}`.slice(0, 40),
      },
    });
    ids.customers[name] = customer.id;
    const address = await prisma.serviceAddress.create({
      data: { customerId: customer.id, line1: "1 Test St", city: "Greeley", zip: "80631" },
    });
    ids.addresses.push(address.id);
    return { customer, address };
  }

  async function makeAgreement(
    name: string,
    customerName: string,
    data: {
      status: "ACTIVE" | "ENDED" | "CANCELLED";
      stripeSubscriptionId: string | null;
      billingStartedAt?: Date | null;
    },
  ) {
    const agreement = await prisma.rentalAgreement.create({
      data: {
        customerId: ids.customers[customerName],
        serviceAddressId: ids.addresses[ids.addresses.length - 1],
        ...data,
      },
    });
    ids.agreements[name] = agreement.id;
    return agreement;
  }

  async function makeInvoice(
    name: string,
    customerName: string,
    status: "PAID" | "OPEN",
    amountDueCents: number,
    amountPaidCents: number,
  ) {
    const invoice = await prisma.invoice.create({
      data: { customerId: ids.customers[customerName], status, amountDueCents, amountPaidCents },
    });
    ids.invoices[name] = invoice.id;
    return invoice;
  }

  async function makeOp(
    name: string,
    status: "PENDING" | "UNKNOWN" | "FAILED" | "SUCCEEDED" | "DRIFT",
    requestedAt: Date,
    attempts = 1,
  ) {
    const key = `drift-int-${tag}-${name}`;
    opKeys.push(key);
    const op = await prisma.providerOperation.create({
      data: {
        kind: "SUBSCRIPTION_CANCEL",
        subjectType: "RentalAgreement",
        subjectId: `drift-subject-${tag}-${name}`,
        idempotencyKey: key,
        status,
        attempts,
        requestedAt,
      },
    });
    ids.ops[name] = op.id;
    return op;
  }

  beforeAll(async () => {
    const base = Date.now() - 3_600_000;
    const sub = (n: string) => `sub_drift_${tag}_${n}`;
    const cus = (n: string) => `cus_drift_${tag}_${n}`;

    // Stripe-side truth (simulated).
    stripeSim.subscriptions.set(sub("live"), "active");
    stripeSim.subscriptions.set(sub("canceled"), "canceled");
    stripeSim.subscriptions.set(sub("gone"), "missing");
    stripeSim.subscriptions.set(sub("activeok"), "active");
    stripeSim.customers.set(cus("deleted"), "deleted");
    stripeSim.customers.set(cus("missing"), "missing");
    stripeSim.customers.set(cus("ok"), "ok");

    // Customers: one deleted at Stripe, one missing at Stripe, one healthy.
    await makeCustomer("cusdeleted", cus("deleted"));
    await makeCustomer("cusmissing", cus("missing"));
    await makeCustomer("cusok", cus("ok"));
    // Customer that owns agreements/invoices/payments (no Stripe id).
    await makeCustomer("owner", null);

    // Agreements.
    const startedAt = new Date(base);
    await makeAgreement("endedLive", "owner", { status: "ENDED", stripeSubscriptionId: sub("live") });
    await makeAgreement("cancelledOk", "owner", {
      status: "CANCELLED",
      stripeSubscriptionId: sub("canceled"),
    });
    await makeAgreement("endedGone", "owner", { status: "ENDED", stripeSubscriptionId: sub("gone") });
    await makeAgreement("activeNoSub", "owner", {
      status: "ACTIVE",
      stripeSubscriptionId: null,
      billingStartedAt: startedAt,
    });
    await makeAgreement("activeHealthy", "owner", {
      status: "ACTIVE",
      stripeSubscriptionId: sub("activeok"),
      billingStartedAt: startedAt,
    });
    await makeAgreement("activeNotBilling", "owner", {
      status: "ACTIVE",
      stripeSubscriptionId: null,
      billingStartedAt: null,
    });

    // Invoices.
    await makeInvoice("paidShort", "owner", "PAID", 10_000, 4_000);
    await makeInvoice("openCovered", "owner", "OPEN", 10_000, 10_000);
    await makeInvoice("paidFull", "owner", "PAID", 10_000, 10_000);
    await makeInvoice("openUnpaid", "owner", "OPEN", 10_000, 0);

    // Receipts / payments.
    const receipt = await prisma.receipt.create({
      data: {
        customerId: ids.customers.owner,
        source: "MANUAL",
        amountCents: 10_000,
        method: "cash",
        receivedOn: new Date(base),
      },
    });
    ids.receipts.push(receipt.id);
    const pay = async (
      name: string,
      invoice: string,
      status: string,
      receiptId: string | null,
    ) => {
      const p = await prisma.payment.create({
        data: { invoiceId: ids.invoices[invoice], amountCents: 10_000, status, receiptId },
      });
      ids.payments[name] = p.id;
    };
    await pay("noReceipt", "paidFull", "succeeded", null);
    await pay("withReceipt", "paidFull", "succeeded", receipt.id);
    await pay("failedNoReceipt", "openUnpaid", "failed", null);

    // Provider operations, oldest first so ordering is deterministic.
    await makeOp("pending", "PENDING", new Date(base + 1_000), 1);
    await makeOp("unknown", "UNKNOWN", new Date(base + 2_000), 2);
    await makeOp("failed", "FAILED", new Date(base + 3_000), 1);
    await makeOp("succeeded", "SUCCEEDED", new Date(base + 4_000));
    await makeOp("drift", "DRIFT", new Date(base + 5_000));

    // Rows in the other tables the read-only guarantee covers.
    const credit = await prisma.customerCredit.create({
      data: {
        customerId: ids.customers.owner,
        amountCents: 500,
        remainingCents: 500,
        reason: `drift-int-${tag}`,
      },
    });
    ids.credits.push(credit.id);
    const audit = await prisma.auditLog.create({
      data: { action: "drift.test", entityType: "DriftTest", entityId: `drift-${tag}` },
    });
    ids.audits.push(audit.id);
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { id: { in: Object.values(ids.payments) } } });
    await prisma.receipt.deleteMany({ where: { id: { in: ids.receipts } } });
    await prisma.invoice.deleteMany({ where: { id: { in: Object.values(ids.invoices) } } });
    await prisma.customerCredit.deleteMany({ where: { id: { in: ids.credits } } });
    await prisma.auditLog.deleteMany({ where: { id: { in: ids.audits } } });
    await prisma.rentalAgreement.deleteMany({
      where: { id: { in: Object.values(ids.agreements) } },
    });
    await prisma.serviceAddress.deleteMany({ where: { id: { in: ids.addresses } } });
    await prisma.customer.deleteMany({ where: { id: { in: Object.values(ids.customers) } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.providerOperation.deleteMany({ where: { idempotencyKey: { in: opKeys } } });
  });

  beforeEach(() => {
    stripeSim.calls.length = 0;
    stripeSim.clientUnavailable = false;
  });

  // Full-row snapshot of everything this test seeded, plus per-table counts
  // scoped to it. (Global counts would race with other integration files that
  // share the same database and run in parallel.)
  async function snapshot() {
    const customerIds = Object.values(ids.customers);
    const invoiceIds = Object.values(ids.invoices);
    return {
      customers: await prisma.customer.findMany({
        where: { id: { in: customerIds } },
        orderBy: { id: "asc" },
      }),
      agreements: await prisma.rentalAgreement.findMany({
        where: { id: { in: Object.values(ids.agreements) } },
        orderBy: { id: "asc" },
      }),
      invoices: await prisma.invoice.findMany({
        where: { id: { in: invoiceIds } },
        orderBy: { id: "asc" },
      }),
      payments: await prisma.payment.findMany({
        where: { invoiceId: { in: invoiceIds } },
        orderBy: { id: "asc" },
      }),
      receipts: await prisma.receipt.findMany({
        where: { customerId: { in: customerIds } },
        orderBy: { id: "asc" },
      }),
      ops: await prisma.providerOperation.findMany({
        where: { idempotencyKey: { in: opKeys } },
        orderBy: { id: "asc" },
      }),
      credits: await prisma.customerCredit.findMany({
        where: { customerId: { in: customerIds } },
        orderBy: { id: "asc" },
      }),
      audits: await prisma.auditLog.findMany({
        where: { entityId: { startsWith: `drift-${tag}` } },
        orderBy: { id: "asc" },
      }),
      auditsAnyForSeeded: await prisma.auditLog.count({
        where: { entityId: { in: [...customerIds, ...invoiceIds, ...Object.values(ids.agreements)] } },
      }),
    };
  }

  const mine = (rows: DriftRow[]) => {
    const subjects = new Set<string>([
      ...Object.values(ids.customers),
      ...Object.values(ids.agreements),
      ...Object.values(ids.invoices),
      ...Object.values(ids.payments),
      ...Object.values(ids.ops).map((_, i) => `drift-subject-${tag}-${Object.keys(ids.ops)[i]}`),
    ]);
    return rows.filter((row) => subjects.has(row.subjectId));
  };
  const find = (rows: DriftRow[], kind: DriftRow["kind"], subjectId: string) =>
    rows.find((row) => row.kind === kind && row.subjectId === subjectId);

  it("lists every detectable mismatch kind with the right kind and subject", async () => {
    const rows = mine(await detectDrift(500));

    const expectations: Array<[DriftRow["kind"], string, string, RegExp]> = [
      ["PENDING_OP", "RentalAgreement", `drift-subject-${tag}-pending`, /pending after 1 attempt\./],
      ["UNKNOWN_OP", "RentalAgreement", `drift-subject-${tag}-unknown`, /unknown after 2 attempts\./],
      ["FAILED_OP", "RentalAgreement", `drift-subject-${tag}-failed`, /failed after 1 attempt\./],
      ["LOCAL_ACTIVE_NO_SUB", "RentalAgreement", ids.agreements.activeNoSub, /no Stripe subscription id/],
      ["INVOICE_STATUS_MISMATCH", "Invoice", ids.invoices.paidShort, /PAID invoice has 4000¢ paid against 10000¢ due/],
      ["INVOICE_STATUS_MISMATCH", "Invoice", ids.invoices.openCovered, /OPEN invoice has 10000¢ paid against 10000¢ due/],
      ["PAYMENT_WITHOUT_RECEIPT", "Payment", ids.payments.noReceipt, /no Receipt ledger event/],
      ["SUB_LIVE_BUT_LOCAL_CLOSED", "RentalAgreement", ids.agreements.endedLive, /is active\./],
      ["STRIPE_CUSTOMER_MISSING", "Customer", ids.customers.cusdeleted, /deleted Stripe customer/],
      ["STRIPE_CUSTOMER_MISSING", "Customer", ids.customers.cusmissing, /missing Stripe customer/],
    ];
    for (const [kind, subjectType, subjectId, detail] of expectations) {
      const row = find(rows, kind, subjectId);
      expect(row, `${kind} for ${subjectId}`).toBeDefined();
      expect(row!.subjectType).toBe(subjectType);
      expect(row!.detail).toMatch(detail);
      expect(row!.since).toBeInstanceOf(Date);
    }
    expect(rows).toHaveLength(expectations.length);
  });

  it("does not list healthy, matching, or intentionally-ignored records", async () => {
    const rows = mine(await detectDrift(500));
    const listed = new Set(rows.map((row) => row.subjectId));

    // Healthy / matching records.
    expect(listed.has(ids.agreements.cancelledOk)).toBe(false); // Stripe canceled too
    expect(listed.has(ids.agreements.activeHealthy)).toBe(false); // has a subscription
    expect(listed.has(ids.agreements.activeNotBilling)).toBe(false); // billing not started yet
    expect(listed.has(ids.invoices.paidFull)).toBe(false);
    expect(listed.has(ids.invoices.openUnpaid)).toBe(false);
    expect(listed.has(ids.payments.withReceipt)).toBe(false);
    expect(listed.has(ids.payments.failedNoReceipt)).toBe(false); // only "succeeded" needs a receipt
    expect(listed.has(ids.customers.cusok)).toBe(false);
    expect(listed.has(ids.customers.owner)).toBe(false);
    // Finished operations are not drift for the workbench.
    expect(listed.has(`drift-subject-${tag}-succeeded`)).toBe(false);
    expect(listed.has(`drift-subject-${tag}-drift`)).toBe(false);
    // Code treats a missing Stripe subscription on a closed agreement as fine.
    expect(listed.has(ids.agreements.endedGone)).toBe(false);
  });

  it("is bounded: the limit caps the result, clamps to at least 1, and never reaches Stripe when full", async () => {
    const three = await detectDrift(3);
    expect(three).toHaveLength(3);
    // Provider operations are reported first, oldest first.
    expect(three.every((row) => ["PENDING_OP", "UNKNOWN_OP", "FAILED_OP"].includes(row.kind))).toBe(true);
    expect(stripeSim.calls).toEqual([]); // cap reached before any Stripe read

    expect(await detectDrift(0)).toHaveLength(1);
    expect(await detectDrift(-5)).toHaveLength(1);

    const sizes = [1, 2, 5, 8, 12];
    for (const size of sizes) {
      expect((await detectDrift(size)).length).toBeLessThanOrEqual(size);
    }
    // Over-large requests are clamped to 500, never unbounded.
    expect((await detectDrift(1_000_000)).length).toBeLessThanOrEqual(500);
  });

  it("still reports local drift when Stripe cannot be reached, skipping provider comparisons", async () => {
    stripeSim.clientUnavailable = true;
    const rows = mine(await detectDrift(500));
    const kinds = new Set(rows.map((row) => row.kind));
    expect(kinds.has("LOCAL_ACTIVE_NO_SUB")).toBe(true);
    expect(kinds.has("INVOICE_STATUS_MISMATCH")).toBe(true);
    expect(kinds.has("SUB_LIVE_BUT_LOCAL_CLOSED")).toBe(false);
    expect(kinds.has("STRIPE_CUSTOMER_MISSING")).toBe(false);
    expect(stripeSim.calls).toEqual([]);
  });

  it("performs NO writes: database rows are identical and Stripe only receives retrieve calls", async () => {
    const before = await snapshot();
    expect(before.ops).toHaveLength(5);
    expect(before.credits).toHaveLength(1);
    expect(before.audits).toHaveLength(1);

    const first = await detectDrift(500);
    const second = await detectDrift(500);
    await detectDrift(3);

    const after = await snapshot();
    expect(after).toEqual(before); // values and updatedAt of every seeded row, plus counts

    // Detection is repeatable: running it did not change what it reports.
    expect(mine(second).map((r) => `${r.kind}:${r.subjectId}`).sort()).toEqual(
      mine(first).map((r) => `${r.kind}:${r.subjectId}`).sort(),
    );

    // Stripe saw reads only, and the expected ones happened.
    expect(stripeSim.calls.length).toBeGreaterThan(0);
    for (const call of stripeSim.calls) {
      expect(["subscriptions.retrieve", "customers.retrieve"]).toContain(call);
      expect(call).toMatch(/\.(retrieve|list|search)$/);
      expect(call).not.toMatch(/\.(create|update|cancel|del|delete)$/);
    }
    expect(stripeSim.calls).toContain("subscriptions.retrieve");
    expect(stripeSim.calls).toContain("customers.retrieve");
  });
});
