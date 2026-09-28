import { describe, it, expect, vi, beforeEach } from "vitest";

// scripts/reset-test-data.ts — resets test/customer data (Chris's
// system-testing cleanup) without ever touching a real login. See
// docs/DECISIONS.md's 2026-09-28 "Resetting test data without losing
// your login" entry. The two things worth real test coverage: (1) it
// truly does nothing without --yes, and (2) when it runs, every table
// it touches is deleted in an order that respects the schema's foreign
// keys (children before the parents they reference), the User delete is
// scoped to role: "CUSTOMER" only, and Photo is filtered rather than
// wiped wholesale (an appliance-only photo must survive).

const calls: string[] = [];

function trackedDeleteMany(label: string) {
  return vi.fn((...args: unknown[]) => {
    calls.push(label);
    return Promise.resolve({ count: 1, args });
  });
}

let tx: Record<string, { deleteMany: ReturnType<typeof vi.fn> }>;
const transactionMock = vi.fn(async (callback: (tx: unknown) => Promise<void>) => {
  await callback(tx);
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (...args: unknown[]) => transactionMock(...(args as [(tx: unknown) => Promise<void>])),
  },
}));

import { main } from "../scripts/reset-test-data";

const MODELS = [
  "photo",
  "jobAppliance",
  "invoiceLineItem",
  "payment",
  "refund",
  "signatureRecord",
  "deposit",
  "applianceAssignment",
  "rentalLine",
  "leadApplianceRequest",
  "customerNote",
  "customerContact",
  "customerCredit",
  "consentRecord",
  "referral",
  "job",
  "invoice",
  "maintenanceRequest",
  "rentalAgreement",
  "serviceAddress",
  "customer",
  "lead",
  "user",
  "verification",
];

describe("reset-test-data script", () => {
  beforeEach(() => {
    calls.length = 0;
    transactionMock.mockClear();
    tx = Object.fromEntries(MODELS.map((m) => [m, { deleteMany: trackedDeleteMany(m) }]));
  });

  it("does nothing without --yes (dry run)", async () => {
    await main([]);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("deletes every expected table when --yes is given", async () => {
    await main(["--yes"]);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    for (const model of MODELS) {
      expect(tx[model].deleteMany).toHaveBeenCalledTimes(1);
    }
  });

  it("only deletes CUSTOMER-role users, never OWNER/ADMIN/STAFF", async () => {
    await main(["--yes"]);
    expect(tx.user.deleteMany).toHaveBeenCalledWith({ where: { role: "CUSTOMER" } });
  });

  it("filters Photo to job/maintenance-linked rows, never wipes appliance-only photos", async () => {
    await main(["--yes"]);
    expect(tx.photo.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ jobId: { not: null } }, { maintenanceRequestId: { not: null } }] },
    });
  });

  it("clears Verification unconditionally (short-lived tokens for everyone)", async () => {
    await main(["--yes"]);
    expect(tx.verification.deleteMany).toHaveBeenCalledWith({});
  });

  it("deletes every child table before the parent it references", async () => {
    await main(["--yes"]);

    function before(child: string, parent: string) {
      expect(calls.indexOf(child)).toBeGreaterThanOrEqual(0);
      expect(calls.indexOf(parent)).toBeGreaterThanOrEqual(0);
      expect(calls.indexOf(child)).toBeLessThan(calls.indexOf(parent));
    }

    // Photo/JobAppliance reference Job; Job must survive long enough for
    // them to be cleared first.
    before("photo", "job");
    before("jobAppliance", "job");
    // Invoice's own children.
    before("invoiceLineItem", "invoice");
    before("payment", "invoice");
    before("refund", "invoice");
    // RentalAgreement's own children.
    before("signatureRecord", "rentalAgreement");
    before("deposit", "rentalAgreement");
    before("applianceAssignment", "rentalLine");
    before("rentalLine", "rentalAgreement");
    // Lead's own child.
    before("leadApplianceRequest", "lead");
    // Customer's own children.
    before("customerNote", "customer");
    before("customerContact", "customer");
    before("customerCredit", "customer");
    before("consentRecord", "customer");
    before("referral", "customer");
    before("job", "customer");
    before("invoice", "customer");
    before("maintenanceRequest", "customer");
    before("rentalAgreement", "customer");
    before("serviceAddress", "customer");
    // Job also references MaintenanceRequest and ServiceAddress.
    before("job", "maintenanceRequest");
    before("job", "serviceAddress");
    // RentalAgreement also references ServiceAddress.
    before("rentalAgreement", "serviceAddress");
    // Customer references User.
    before("customer", "user");
  });
});
