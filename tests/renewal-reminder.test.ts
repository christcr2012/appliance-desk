import { describe, expect, it } from "vitest";
import { composeRenewalReminder, renewalReminderKey } from "@/domains/notices/renewal-reminder";

const input = {
  customerName: "Pat Jones",
  termMonths: 12,
  termEndDate: new Date("2027-11-08T06:59:59Z"),
  renewalStartDate: new Date("2027-11-08T07:00:00Z"),
  monthlyTotalCents: 6550,
  lineLabels: ["Washer", "Dryer"],
  renewalTermsText: "  Your rental renews month to month unless you cancel.  ",
  businessName: "Robinson Appliance Rentals",
  businessPhone: "970-555-0100",
  businessEmail: "hello@example.test",
};

describe("renewal reminder wording", () => {
  it("states the dates, the price, how to stop it, and repeats the agreed renewal wording word for word", () => {
    const { subject, body } = composeRenewalReminder(input);
    expect(subject).toContain("November 7, 2027");
    expect(body).toContain("Hello Pat Jones,");
    expect(body).toContain("12-month rental (Washer, Dryer) ends on");
    expect(body).toContain("starting Monday, November 8, 2027 at $65.50 a month");
    expect(body).toContain("Your rental renews month to month unless you cancel.");
    expect(body).toContain("970-555-0100");
    expect(body).toContain("hello@example.test");
  });
  it("uses one stable key per agreement and term end, so a reminder is never created twice", () => {
    expect(renewalReminderKey("a1", input.termEndDate)).toBe("renewal-reminder-a1-2027-11-08");
  });
});
