import { describe, expect, it } from "vitest";
import { InvoiceStatus, JobStatus, RentalAgreementStatus } from "@prisma/client";
import { STATUS_NEXT, billNextKey, billNext } from "@/lib/status-next";

const now = new Date("2026-10-27T18:00:00Z");
const sample = { status: "OPEN" as InvoiceStatus, dueDate: null, amountDueCents: 15000, amountPaidCents: 0 };
describe("AR-12 plain next steps", () => {
  it("covers every actual rental and visit enum status", () => {
    expect(Object.keys(STATUS_NEXT.rental).sort()).toEqual(Object.values(RentalAgreementStatus).sort());
    expect(Object.keys(STATUS_NEXT.visit).sort()).toEqual(Object.values(JobStatus).sort());
    for (const value of Object.values(STATUS_NEXT.rental)) expect(value).toMatch(/\.$/);
    for (const value of Object.values(STATUS_NEXT.visit)) expect(value).toMatch(/\.$/);
  });
  it("covers all bill enums and separates in-flight payments from failed cards", () => {
    for (const status of Object.values(InvoiceStatus)) {
      const key = billNextKey({ ...sample, status }, now);
      expect(STATUS_NEXT.bill[key], status).toMatch(/\.$/);
    }
    expect(billNextKey({ ...sample, beingConfirmed: true }, now)).toBe("being-confirmed");
    expect(billNext({ ...sample, beingConfirmed: true }, now)).not.toMatch(/reminder/i);
    expect(billNextKey({ ...sample, status: "FAILED" }, now)).toBe("payment-failed");
    expect(billNextKey({ ...sample, dueDate: new Date("2026-10-20T18:00:00Z") }, now)).toBe("past-due");
    expect(billNextKey({ ...sample, dueDate: new Date("2026-10-27T18:00:00Z") }, now)).toBe("open");
    expect(billNextKey({ ...sample, amountPaidCents: 15000 }, now)).toBe("paid");
    expect(billNextKey({ ...sample, status: "VOID" }, now)).toBe("cancelled");
    expect(billNextKey({ ...sample, status: "DRAFT" }, now)).toBe("draft");
  });
  it("uses the exact approved sentences", () => {
    expect(STATUS_NEXT.bill["being-confirmed"]).toBe("The bank is confirming this payment. Nothing to do.");
    expect(STATUS_NEXT.bill.open).toBe("Waiting for payment.");
    expect(STATUS_NEXT.rental.ACTIVE).toBe("Renting now.");
    expect(STATUS_NEXT.visit.SCHEDULED).toBe("Booked.");
  });
});
