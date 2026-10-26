// OPS-7: what the Privacy and security screens show, and the owner's To do items for these duties.
import { prisma } from "@/lib/prisma";
import { readBreachRules } from "./actions";
import { accessibilityFixBy, incidentSteps, vendorReviewDue, type IncidentStep } from "./rules";
import { ruleAsOf } from "@/domains/rules/reads";
import type { ExceptionItem } from "@/domains/exceptions/rules";

export async function loadPrivacyOverview(now: Date) {
  const [settings, incidents, vendors, complaints, holds, rules, fixDays] = await Promise.all([
    prisma.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {} }),
    prisma.securityIncident.findMany({ orderBy: [{ state: "asc" }, { discoveredAt: "desc" }], take: 25 }),
    prisma.serviceVendor.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.accessibilityComplaint.findMany({ orderBy: [{ resolvedAt: { sort: "asc", nulls: "first" } }, { receivedAt: "desc" }], take: 25 }),
    prisma.customer.findMany({ where: { legalHoldAt: { not: null } }, select: { id: true, legalHoldAt: true, legalHoldReason: true, user: { select: { name: true, email: true } } }, take: 100 }),
    readBreachRules(now),
    ruleAsOf<number>("co.accessibility_fix_days", now),
  ]);
  return {
    settings, rules, fixDays: fixDays.value,
    incidents: incidents.map((i) => ({ ...i, steps: i.state === "OPEN" ? incidentSteps(i, rules) : ([] as IncidentStep[]) })),
    vendors: vendors.map((v) => ({ ...v, due: vendorReviewDue(v.termsReviewedOn, now, settings.vendorReviewMonths) })),
    complaints: complaints.map((c) => ({ ...c, fixBy: accessibilityFixBy(c.receivedAt, fixDays.value) })),
    holds,
  };
}

const dateText = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric" }).format(d);

/** Owner-only To do items: open incident steps (fixed deadlines), vendor terms due, accessibility complaints with their fix date. */
export async function listPrivacyAttention(now: Date): Promise<ExceptionItem[]> {
  const [rules, fixDays, settings, incidents, vendors, complaints] = await Promise.all([
    readBreachRules(now),
    ruleAsOf<number>("co.accessibility_fix_days", now),
    prisma.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {}, select: { vendorReviewMonths: true } }),
    prisma.securityIncident.findMany({ where: { state: "OPEN" }, orderBy: { discoveredAt: "asc" }, take: 20 }),
    prisma.serviceVendor.findMany({ where: { active: true }, select: { name: true, termsReviewedOn: true } }),
    prisma.accessibilityComplaint.findMany({ where: { resolvedAt: null }, orderBy: { receivedAt: "asc" }, take: 20 }),
  ]);
  const rows: ExceptionItem[] = [];
  for (const incident of incidents) {
    for (const step of incidentSteps(incident, rules).filter((s) => !s.done && s.key !== "VENDORS")) {
      const overdue = step.due ? step.due.getTime() < now.getTime() : false;
      rows.push({
        category: "PRIVACY_DUTY", severity: "high",
        title: step.due ? `Security problem: ${step.label.toLowerCase()} by ${dateText(step.due)}${overdue ? " (past the deadline)" : ""}` : `Security problem: ${step.label.toLowerCase()}`,
        detail: "Colorado sets this deadline. The date is fixed once you record when you decided. Nothing is sent for you.",
        href: "/desk/privacy-security", since: incident.determinedAt ?? incident.discoveredAt,
      });
    }
  }
  const dueVendors = vendors.filter((v) => vendorReviewDue(v.termsReviewedOn, now, settings.vendorReviewMonths));
  if (dueVendors.length > 0) {
    rows.push({
      category: "PRIVACY_DUTY", severity: "low",
      title: `Re-read the security terms for ${dueVendors.length === 1 ? dueVendors[0].name : `${dueVendors.length} service providers`}`,
      detail: "Colorado asks you to make sure companies that hold customer information keep it safe. Open each provider's security page, then record the date.",
      href: "/desk/privacy-security#providers", since: now,
    });
  }
  for (const c of complaints) {
    const fixBy = accessibilityFixBy(c.receivedAt, fixDays.value);
    rows.push({
      category: "PRIVACY_DUTY", severity: fixBy.getTime() < now.getTime() ? "high" : "medium",
      title: `Fix the accessibility problem by ${dateText(fixBy)}`,
      detail: c.description.slice(0, 160), href: "/desk/privacy-security#accessibility", since: c.receivedAt,
    });
  }
  return rows;
}
