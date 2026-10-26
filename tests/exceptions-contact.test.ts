import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ role: vi.fn(), leads: vi.fn(), leadCount: vi.fn(), days: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/prisma", () => ({ prisma: { lead: { findMany: m.leads, count: m.leadCount } } }));
vi.mock("@/domains/leads/follow-up", () => ({ getLeadResponseDays: m.days }));
import { pastDueTodoItem } from "@/domains/exceptions";
import { listNewLeadContact } from "@/domains/exceptions/lead-turning-points";
import { customerContact, leadContact } from "@/domains/exceptions/rules";

describe("To do items carry how to reach the customer or lead (TODAY 2)", () => {
  beforeEach(() => {
    m.role.mockResolvedValue({ user: { role: "OWNER" } });
    m.days.mockResolvedValue(0);
  });

  it("PAST_DUE_INVOICE has the customer's phone and email", () => {
    const item = pastDueTodoItem({
      id: "i1",
      customerId: "c1",
      status: "DELINQUENT",
      dueDate: new Date("2026-10-20T06:00:00Z"),
      updatedAt: new Date("2026-10-21T06:00:00Z"),
      amountDueCents: 7000,
      amountPaidCents: 0,
      payments: [],
      customer: { phone: "970-555-0100", user: { name: "Maria Lopez", email: "maria@example.test" } },
    });
    expect(item.category).toBe("PAST_DUE_INVOICE");
    expect(item.contact).toEqual({ phone: "970-555-0100", email: "maria@example.test" });
  });

  it("NEW_LEAD_CONTACT has the lead's phone and email, read in the same query", async () => {
    m.leads.mockResolvedValue([{ id: "l1", contactName: "James Carter", createdAt: new Date("2026-10-25T12:00:00Z"), phone: "970-555-0199", email: null }]);
    const { rows } = await listNewLeadContact(10);
    expect(rows[0].contact).toEqual({ phone: "970-555-0199" });
    expect(m.leads.mock.calls[0][0].select).toMatchObject({ phone: true, email: true });
  });

  it("leaves blank values out", () => {
    expect(customerContact({ phone: " ", user: { email: "" } })).toBeUndefined();
    expect(leadContact({ phone: "", email: "x@example.test" })).toEqual({ email: "x@example.test" });
  });
});
