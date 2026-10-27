import { describe, expect, it } from "vitest";
import {
  certificateEmailDraft, checkCertificateRequest, checkPolicyInput, renewalState, validateReminderDays, workersCompRequiredNow, workersCompSummary,
} from "@/domains/insurance/rules";

const day = (key: string) => new Date(`${key}T12:00:00Z`);
const now = day("2026-10-26");

describe("renewal reminders", () => {
  it("is quiet until the first reminder, then first, then second, then ended", () => {
    expect(renewalState(day("2027-01-30"), now, 60, 30).kind).toBe("ok"); // 96 days
    expect(renewalState(day("2026-12-20"), now, 60, 30)).toEqual({ kind: "first", daysLeft: 55 });
    expect(renewalState(day("2026-11-20"), now, 60, 30)).toEqual({ kind: "second", daysLeft: 25 });
    expect(renewalState(day("2026-10-26"), now, 60, 30)).toEqual({ kind: "second", daysLeft: 0 });
    expect(renewalState(day("2026-10-20"), now, 60, 30)).toEqual({ kind: "expired", daysOver: 6 });
  });
  it("lands exactly on the boundaries", () => {
    expect(renewalState(day("2026-12-25"), now, 60, 30).kind).toBe("first"); // exactly 60
    expect(renewalState(day("2026-12-26"), now, 60, 30).kind).toBe("ok"); // 61
    expect(renewalState(day("2026-11-25"), now, 60, 30).kind).toBe("second"); // exactly 30
  });
  it("checks the reminder numbers", () => {
    expect(validateReminderDays(60, 30)).toBeNull();
    expect(validateReminderDays(30, 30)).not.toBeNull();
    expect(validateReminderDays(30, 60)).not.toBeNull();
    expect(validateReminderDays(0, -1)).not.toBeNull();
    expect(validateReminderDays(400, 30)).not.toBeNull();
    expect(validateReminderDays(60.5, 30)).not.toBeNull();
  });
});

describe("workers' compensation", () => {
  it("is required only when there are employees and no policy in place", () => {
    expect(workersCompRequiredNow("NOT_SET", 0, false)).toBe(false);
    expect(workersCompRequiredNow("NO_EMPLOYEES_REJECTED", 0, false)).toBe(false);
    expect(workersCompRequiredNow("NOT_SET", 1, false)).toBe(true);
    expect(workersCompRequiredNow("NO_EMPLOYEES_REJECTED", 2, false)).toBe(true);
    expect(workersCompRequiredNow("POLICY_IN_PLACE", 2, true)).toBe(false);
    expect(workersCompRequiredNow("POLICY_IN_PLACE", 2, false)).toBe(true); // says in place, but no live policy recorded
  });
  it("summarises each status in plain words", () => {
    expect(workersCompSummary({ status: "NOT_SET", note: null })).toMatch(/Not recorded/);
    expect(workersCompSummary({ status: "NO_EMPLOYEES_REJECTED", note: null, formSentOnText: "Oct 1, 2026", mailNumber: "7019 0001" })).toMatch(/form sent Oct 1, 2026.*certified mail 7019 0001/);
    expect(workersCompSummary({ status: "POLICY_IN_PLACE", note: "Pinnacol" })).toMatch(/in place \(Pinnacol\)/);
  });
});

describe("policy input", () => {
  const ok = { kind: "GENERAL_LIABILITY" as const, insurer: "Acme Mutual", policyNumber: "GL-1", expiresOnKey: "2027-03-01" };
  it("accepts a minimal policy", () => expect(checkPolicyInput(ok).problem).toBeNull());
  it("refuses missing or odd values in plain words", () => {
    expect(checkPolicyInput({ ...ok, insurer: " " }).problem).toMatch(/company/);
    expect(checkPolicyInput({ ...ok, policyNumber: "" }).problem).toMatch(/policy number/);
    expect(checkPolicyInput({ ...ok, expiresOnKey: "" }).problem).toMatch(/ends/);
    expect(checkPolicyInput({ ...ok, effectiveOnKey: "2027-04-01" }).problem).toMatch(/before the end/);
    expect(checkPolicyInput({ ...ok, annualPremiumCents: -5 }).problem).toMatch(/yearly cost/);
    expect(checkPolicyInput({ ...ok, agentEmail: "nope" }).problem).toMatch(/email/);
    expect(checkPolicyInput({ ...ok, kind: "BOGUS" as never }).problem).toMatch(/kind/);
  });
});

describe("certificate request", () => {
  it("needs a name and a real email", () => {
    expect(checkCertificateRequest({ requesterName: "", requesterEmail: "a@b.co" })).not.toBeNull();
    expect(checkCertificateRequest({ requesterName: "Pat", requesterEmail: "nope" })).not.toBeNull();
    expect(checkCertificateRequest({ requesterName: "Pat", requesterEmail: "pat@pm.example" })).toBeNull();
  });
  it("drafts an email with the requester's details for the owner to send", () => {
    const d = certificateEmailDraft({
      agentEmail: "agent@ins.example", agentName: "Dana", insurer: "Acme Mutual", policyNumber: "GL-1", kindLabel: "General liability", businessName: "Robinson Appliance Rentals",
      requester: { requesterName: "Pat Lee", requesterCompany: "Front Range Property Mgmt", requesterEmail: "pat@pm.example", holderText: "Front Range Property Mgmt, additional insured" }, ownerName: "Chris Robinson",
    });
    expect(d.to).toBe("agent@ins.example");
    expect(d.body).toContain("Pat Lee, Front Range Property Mgmt");
    expect(d.body).toContain("pat@pm.example");
    expect(d.body).toContain("additional insured");
    expect(d.mailto.startsWith("mailto:agent%40ins.example?subject=")).toBe(true);
  });
});
