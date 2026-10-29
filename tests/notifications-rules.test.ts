import { describe, expect, it } from "vitest";
import { allowedKindsFor, recipientsFor, type NotificationPerson } from "@/domains/notifications/rules";

// AR-13: the recipient table (NOTIFICATIONS.md section 3) and the read-side kinds (section 5), pure.

const ALL_SCREENS = ["leads", "estimates", "agreements", "billing", "management", "tasks", "customers"];

function person(partial: Partial<NotificationPerson> & { id: string }): NotificationPerson {
  return { role: "STAFF", archivedAt: null, screens: null, ...partial };
}

const owner = person({ id: "owner", role: "OWNER" });
const admin = person({ id: "admin", role: "ADMIN" });
const adminNoBilling = person({ id: "admin-nb", role: "ADMIN", screens: ALL_SCREENS.filter((s) => s !== "billing") });
const adminNoLeads = person({ id: "admin-nl", role: "ADMIN", screens: ALL_SCREENS.filter((s) => s !== "leads") });
const staffOffice = person({ id: "staff-office", role: "STAFF", screens: ["leads", "customers", "tasks"] });
const staffDriver = person({ id: "staff-driver", role: "STAFF", screens: ["dispatch", "tasks"] });
const customer = person({ id: "customer", role: "CUSTOMER" });
const accountant = person({ id: "acct", role: "ACCOUNTANT" });
const archivedAdmin = person({ id: "admin-old", role: "ADMIN", archivedAt: new Date() });

const EVERYONE = [owner, admin, adminNoBilling, adminNoLeads, staffOffice, staffDriver, customer, accountant, archivedAdmin];
const ids = (people: NotificationPerson[]) => people.map((p) => p.id).sort();

describe("recipientsFor", () => {
  it("LEAD_NEW goes to owners and admins who can open leads, nobody else", () => {
    const got = recipientsFor("LEAD_NEW", EVERYONE, { href: "/desk/leads/lead-1" });
    expect(ids(got)).toEqual(["admin", "admin-nb", "owner"]);
  });

  it("LEAD_NEW also reaches the assignee, even staff, when they can open leads", () => {
    const got = recipientsFor("LEAD_NEW", EVERYONE, { href: "/desk/leads/lead-1", assigneeId: "staff-office" });
    expect(ids(got)).toEqual(["admin", "admin-nb", "owner", "staff-office"]);
  });

  it("LEAD_NEW never reaches the person who created the lead by hand", () => {
    const got = recipientsFor("LEAD_NEW", EVERYONE, { href: "/desk/leads/lead-1", assigneeId: "staff-office", excludeUserId: "admin" });
    expect(ids(got)).toEqual(["admin-nb", "owner", "staff-office"]);
    const byAssignee = recipientsFor("LEAD_NEW", EVERYONE, { href: "/desk/leads/lead-1", assigneeId: "admin", excludeUserId: "admin" });
    expect(ids(byAssignee)).toEqual(["admin-nb", "owner"]);
  });

  it("QUOTE_VIEWED goes to owners and admins, plus the quote's creator", () => {
    const got = recipientsFor("QUOTE_VIEWED", EVERYONE, { href: "/desk/estimates/est-1", creatorId: "admin-nl" });
    expect(ids(got)).toEqual(["admin", "admin-nb", "admin-nl", "owner"]);
  });

  it("PAYMENT_FAILED skips an admin whose job role has no billing screen", () => {
    const got = recipientsFor("PAYMENT_FAILED", EVERYONE, { href: "/desk/billing/customer/c-1/invoice/i-1" });
    expect(ids(got)).toEqual(["admin", "admin-nl", "owner"]);
  });

  it("SIGNATURE_DONE goes to owners and admins who can open rentals", () => {
    const got = recipientsFor("SIGNATURE_DONE", EVERYONE, { href: "/desk/agreements/agr-1" });
    expect(ids(got)).toEqual(["admin", "admin-nb", "admin-nl", "owner"]);
  });

  it("APPROVAL_REQUESTED goes to the owner only", () => {
    const got = recipientsFor("APPROVAL_REQUESTED", EVERYONE, { href: "/desk/approvals" });
    expect(ids(got)).toEqual(["owner"]);
  });

  it("customers, accountants and archived people receive nothing of any kind", () => {
    for (const kind of ["LEAD_NEW", "QUOTE_VIEWED", "SIGNATURE_DONE", "PAYMENT_FAILED", "APPROVAL_REQUESTED"] as const) {
      const got = recipientsFor(kind, EVERYONE, { href: "/desk/leads/x", assigneeId: "customer", creatorId: "acct" });
      expect(got.some((p) => ["customer", "acct", "admin-old"].includes(p.id))).toBe(false);
    }
  });
});

describe("allowedKindsFor", () => {
  it("the owner can receive and read all five kinds", () => {
    expect(allowedKindsFor(owner).sort()).toEqual(["APPROVAL_REQUESTED", "LEAD_NEW", "PAYMENT_FAILED", "QUOTE_VIEWED", "SIGNATURE_DONE"]);
  });

  it("an admin's kinds narrow with the job role's screens", () => {
    expect(allowedKindsFor(adminNoBilling).sort()).toEqual(["LEAD_NEW", "QUOTE_VIEWED", "SIGNATURE_DONE"]);
    expect(allowedKindsFor(adminNoLeads).sort()).toEqual(["PAYMENT_FAILED", "QUOTE_VIEWED", "SIGNATURE_DONE"]);
  });

  it("staff can read lead notifications only when their job role has the leads screen", () => {
    expect(allowedKindsFor(staffOffice)).toEqual(["LEAD_NEW"]);
    expect(allowedKindsFor(staffDriver)).toEqual([]);
  });

  it("customers, accountants and archived people get none", () => {
    expect(allowedKindsFor(customer)).toEqual([]);
    expect(allowedKindsFor(accountant)).toEqual([]);
    expect(allowedKindsFor(archivedAdmin)).toEqual([]);
  });
});
