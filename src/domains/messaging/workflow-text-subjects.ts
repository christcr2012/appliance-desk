import type { CommunicationLinkEntityType, Prisma } from "@prisma/client";
import { isEstimatePastValidity } from "@/domains/estimates/validity";
import { normalizeSmsAddress } from "./suppression";
import { workflowTextFamily, type WorkflowTextFamily } from "./workflow-text-catalog";

/**
 * Reads the record a workflow text is about and turns it into: who gets it, the phone saved on the record, the exact
 * values for the wording, and the records the message should be filed under. Everything comes from the database on the
 * server; nothing the browser sends is trusted. A record that does not fit the text (an estimate that was never sent, an
 * agreement already signed) is reported in plain words instead of being texted anyway.
 */
export type WorkflowPrincipal = { customerId: string; leadId?: undefined } | { leadId: string; customerId?: undefined };

export type LoadedSubject = {
  principal: WorkflowPrincipal;
  displayName: string;
  /** Digits as saved on the record; null when there is none. */
  rawPhone: string | null;
  /** E.164 phone, or null when missing or not a usable number. */
  phone: string | null;
  values: Record<string, string>;
  links: { entityType: CommunicationLinkEntityType; entityId: string }[];
  /** Plain-English reason this text does not fit the record right now, or null. */
  stateProblem: string | null;
  /** When the lead already became a customer, so an old thread can move to the customer record. */
  convertedFromLeadId: string | null;
};

type Tx = Prisma.TransactionClient;

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://robinsonappliancerentals.com").replace(/\/$/, "");
}

/** First name, trimmed to fit the wording; a missing name becomes "there". */
export function firstNameFor(full: string | null | undefined, maxLength = 16): string {
  const first = (full ?? "").trim().split(/\s+/)[0] ?? "";
  const clean = first.replace(/[^\p{L}\p{N}'.-]/gu, "").slice(0, maxLength);
  return clean || "there";
}

function usablePhone(raw: string | null | undefined): { raw: string | null; phone: string | null } {
  const value = raw?.trim() || null;
  if (!value) return { raw: null, phone: null };
  try { return { raw: value, phone: normalizeSmsAddress(value) }; }
  catch { return { raw: value, phone: null }; }
}

async function loadLead(tx: Tx, id: string): Promise<LoadedSubject | null> {
  const lead = await tx.lead.findUnique({ where: { id }, select: {
    id: true, status: true, contactName: true, phone: true, convertedCustomerId: true } });
  if (!lead) return null;
  const phone = usablePhone(lead.phone);
  const principal: WorkflowPrincipal = { leadId: lead.id };
  return {
    principal, displayName: lead.contactName, rawPhone: phone.raw, phone: phone.phone,
    values: { name: firstNameFor(lead.contactName) },
    links: [{ entityType: "Lead", entityId: lead.id }],
    stateProblem: lead.status === "LOST" ? "This request was marked lost."
      : lead.status === "CONVERTED" || lead.convertedCustomerId ? "This person is already a customer. Text them from their customer page."
      : null,
    convertedFromLeadId: null,
  };
}

type PersonRow = { phone: string | null; user: { name: string | null } };
function personFor(estimate: { customerId: string | null; customer: PersonRow | null;
  leadId: string | null; lead: { contactName: string; phone: string; convertedCustomerId: string | null } | null }):
  { principal: WorkflowPrincipal; name: string; rawPhone: string | null; convertedFromLeadId: string | null } | null {
  if (estimate.customerId && estimate.customer) {
    return { principal: { customerId: estimate.customerId }, name: estimate.customer.user.name ?? "",
      rawPhone: estimate.customer.phone,
      convertedFromLeadId: estimate.leadId && estimate.lead?.convertedCustomerId === estimate.customerId ? estimate.leadId : null };
  }
  if (estimate.leadId && estimate.lead) {
    return { principal: { leadId: estimate.leadId }, name: estimate.lead.contactName,
      rawPhone: estimate.lead.phone, convertedFromLeadId: null };
  }
  return null;
}

async function loadEstimate(tx: Tx, id: string, now: Date): Promise<LoadedSubject | null> {
  const estimate = await tx.estimate.findUnique({ where: { id }, select: {
    id: true, estimateNumber: true, status: true, validUntil: true, customerId: true, leadId: true,
    customer: { select: { phone: true, user: { select: { name: true } } } },
    lead: { select: { contactName: true, phone: true, convertedCustomerId: true } },
  } });
  if (!estimate) return null;
  const person = personFor(estimate);
  if (!person) return null;
  const phone = usablePhone(person.rawPhone);
  let stateProblem: string | null = null;
  if (estimate.status !== "SENT" && estimate.status !== "VIEWED") {
    stateProblem = estimate.status === "DRAFT"
      ? "Send the estimate first, then text the link."
      : "This estimate is no longer waiting for an answer.";
  } else if (isEstimatePastValidity(estimate.validUntil, now)) {
    stateProblem = "This estimate has expired.";
  }
  const link = `${appBaseUrl()}/estimate/${estimate.id}`;
  return {
    principal: person.principal, displayName: person.name, rawPhone: phone.raw, phone: phone.phone,
    values: { name: firstNameFor(person.name), number: String(estimate.estimateNumber), link },
    links: [{ entityType: "Estimate", entityId: estimate.id }],
    stateProblem, convertedFromLeadId: person.convertedFromLeadId,
  };
}

async function loadAgreement(tx: Tx, family: WorkflowTextFamily, id: string): Promise<LoadedSubject | null> {
  const agreement = await tx.rentalAgreement.findUnique({ where: { id }, select: {
    id: true, status: true, customerId: true,
    customer: { select: { phone: true, user: { select: { name: true } } } },
    signature: { select: { id: true, signedAt: true } },
  } });
  if (!agreement) return null;
  const phone = usablePhone(agreement.customer.phone);
  let stateProblem: string | null = null;
  const waiting = agreement.status === "AWAITING_SIGNATURE" && agreement.signature && !agreement.signature.signedAt;
  if (family.key === "signature_received") {
    if (!agreement.signature?.signedAt) stateProblem = "This agreement has not been signed yet.";
  } else if (!waiting) {
    stateProblem = agreement.signature?.signedAt
      ? "This agreement is already signed."
      : "Send the agreement for signature first, then text the signing page.";
  }
  return {
    principal: { customerId: agreement.customerId }, displayName: agreement.customer.user.name ?? "",
    rawPhone: phone.raw, phone: phone.phone,
    values: { name: firstNameFor(agreement.customer.user.name),
      link: agreement.signature ? `${appBaseUrl()}/sign/${agreement.signature.id}` : "" },
    links: [{ entityType: "RentalAgreement", entityId: agreement.id }],
    stateProblem, convertedFromLeadId: null,
  };
}

/** One loader per record type; the family decides which record type is read. Later batches add job and billing records. */
export async function loadWorkflowSubject(
  tx: Tx, familyKey: string, subjectId: string, now: Date,
): Promise<LoadedSubject | null> {
  const family = workflowTextFamily(familyKey);
  if (!family || !subjectId || subjectId.length > 100) return null;
  switch (family.subject) {
    case "Lead": return loadLead(tx, subjectId);
    case "Estimate": return loadEstimate(tx, subjectId, now);
    case "RentalAgreement": return loadAgreement(tx, family, subjectId);
    default: return null;
  }
}
