import type { CommunicationLinkEntityType, Prisma } from "@prisma/client";
import { isEstimatePastValidity } from "@/domains/estimates/validity";
import { normalizeSmsAddress } from "./suppression";
import { formatBusinessTime } from "@/lib/business-date";
import { formatCents } from "@/domains/pricing/money";
import { businessDateKey } from "@/lib/business-date";
import { communicationsPolicySchema } from "./communications-policy";
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
  /** Team member the record is assigned to (jobs), so a STAFF member can act only on their own work. */
  assigneeUserId?: string | null;
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


/** The word that follows "your" in the wording: "your delivery is scheduled…". */
const VISIT_NOUN: Record<string, string> = {
  DELIVERY: "delivery", INSTALLATION: "installation", SWAP: "appliance swap", REMOVAL: "pickup", MAINTENANCE_VISIT: "maintenance visit",
};

function whenLabel(at: Date): string {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short", month: "short", day: "numeric" }).format(at);
  return `${day}, ${formatBusinessTime(at)}`;
}

async function loadJob(tx: Tx, family: WorkflowTextFamily, id: string, now: Date): Promise<LoadedSubject | null> {
  const job = await tx.job.findUnique({ where: { id }, select: {
    id: true, type: true, status: true, scheduledAt: true, assignedToUserId: true, customerId: true,
    customer: { select: { phone: true, user: { select: { name: true } } } } } });
  if (!job || !job.customerId || !job.customer) return null;
  const phone = usablePhone(job.customer.phone);
  const visit = VISIT_NOUN[job.type] ?? "visit";
  let stateProblem: string | null = null;
  const upcoming = job.status === "SCHEDULED" && job.scheduledAt && job.scheduledAt.getTime() > now.getTime();
  switch (family.key) {
    case "job_scheduled": case "job_reminder":
      if (job.status === "CANCELLED") stateProblem = "This visit was cancelled.";
      else if (job.status === "COMPLETED") stateProblem = "This visit is already done.";
      else if (!job.scheduledAt) stateProblem = "Pick a date and time for this visit first.";
      else if (!upcoming) stateProblem = "This visit time has already passed.";
      break;
    case "job_on_the_way":
      if (job.status !== "SCHEDULED" && job.status !== "IN_PROGRESS") stateProblem = "This visit is not open right now.";
      else if (!job.scheduledAt || businessDateKey(job.scheduledAt) !== businessDateKey(now)) stateProblem = "This visit is not scheduled for today.";
      break;
    case "job_completed":
      if (job.status !== "COMPLETED") stateProblem = "This visit has not been marked completed yet.";
      break;
  }
  return {
    principal: { customerId: job.customerId }, displayName: job.customer.user.name ?? "",
    rawPhone: phone.raw, phone: phone.phone,
    values: { name: firstNameFor(job.customer.user.name), visit, when: job.scheduledAt ? whenLabel(job.scheduledAt) : "" },
    links: [{ entityType: "Job", entityId: job.id }], stateProblem, convertedFromLeadId: null,
    assigneeUserId: job.assignedToUserId,
  };
}

async function loadMaintenance(tx: Tx, family: WorkflowTextFamily, id: string): Promise<LoadedSubject | null> {
  const request = await tx.maintenanceRequest.findUnique({ where: { id }, select: {
    id: true, status: true, customerId: true, customer: { select: { phone: true, user: { select: { name: true } } } } } });
  if (!request) return null;
  const phone = usablePhone(request.customer.phone);
  let stateProblem: string | null = null;
  if (family.key === "maintenance_resolved" && request.status !== "RESOLVED" && request.status !== "CLOSED") {
    stateProblem = "This request has not been marked resolved yet.";
  } else if (family.key === "maintenance_received" && (request.status === "RESOLVED" || request.status === "CLOSED")) {
    stateProblem = "This request is already finished.";
  }
  return {
    principal: { customerId: request.customerId }, displayName: request.customer.user.name ?? "",
    rawPhone: phone.raw, phone: phone.phone, values: { name: firstNameFor(request.customer.user.name) },
    links: [{ entityType: "MaintenanceRequest", entityId: request.id }], stateProblem, convertedFromLeadId: null,
  };
}

function dateLabel(at: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric" }).format(at);
}

async function loadInvoice(tx: Tx, family: WorkflowTextFamily, id: string): Promise<LoadedSubject | null> {
  const invoice = await tx.invoice.findUnique({ where: { id }, select: {
    id: true, invoiceNumber: true, status: true, amountDueCents: true, amountPaidCents: true, customerId: true,
    customer: { select: { phone: true, user: { select: { name: true } } } },
    refunds: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { id: true, amountCents: true, stripeRefundId: true } } } });
  // A refund row is created BEFORE the card company is asked. Only a finished refund may be announced.
  const latestRefund = invoice?.refunds[0] ?? null;
  const refundOp = latestRefund ? await tx.providerOperation.findFirst({ where: { kind: "REFUND_CREATE", subjectType: "Refund", subjectId: latestRefund.id },
    orderBy: { requestedAt: "desc" }, select: { status: true } }) : null;
  const refundDone = latestRefund ? (refundOp ? refundOp.status === "SUCCEEDED" : true) : false;
  if (!invoice) return null;
  const phone = usablePhone(invoice.customer.phone);
  const open = ["OPEN", "PARTIALLY_PAID", "DELINQUENT"].includes(invoice.status) && invoice.amountDueCents > invoice.amountPaidCents;
  let stateProblem: string | null = null;
  switch (family.key) {
    case "invoice_ready":
      if (!open) stateProblem = invoice.status === "DRAFT" ? "Issue the invoice first, then text it." : "This invoice is not waiting for payment.";
      break;
    case "invoice_reminder":
      if (!open) stateProblem = "This invoice is not open, so there is nothing to remind about.";
      break;
    case "payment_received":
      if (invoice.status !== "PAID") stateProblem = "This invoice is not fully paid yet.";
      break;
    case "refund_issued":
      if (!invoice.refunds[0]) stateProblem = "No refund has been issued on this invoice.";
      else if (!refundDone) stateProblem = "The latest refund is not finished (it is still being processed or did not go through), so it cannot be announced yet.";
      break;
  }
  return {
    principal: { customerId: invoice.customerId }, displayName: invoice.customer.user.name ?? "",
    rawPhone: phone.raw, phone: phone.phone,
    values: { name: firstNameFor(invoice.customer.user.name), number: String(invoice.invoiceNumber),
      link: `${appBaseUrl()}/account/billing/invoice/${invoice.id}`,
      amount: invoice.refunds[0] ? formatCents(invoice.refunds[0].amountCents) : "" },
    links: [{ entityType: "Invoice", entityId: invoice.id }], stateProblem, convertedFromLeadId: null,
  };
}

async function loadRenewal(tx: Tx, id: string, now: Date): Promise<LoadedSubject | null> {
  const agreement = await tx.rentalAgreement.findUnique({ where: { id }, select: {
    id: true, status: true, termMonths: true, endDate: true, customerId: true,
    customer: { select: { phone: true, user: { select: { name: true } } } } } });
  if (!agreement) return null;
  const phone = usablePhone(agreement.customer.phone);
  const days = agreement.endDate ? (agreement.endDate.getTime() - now.getTime()) / 86_400_000 : null;
  const settingsRow = await tx.businessSettings.findUnique({ where: { id: "singleton" }, select: { communicationsPolicy: true } });
  const parsedPolicy = communicationsPolicySchema.safeParse(settingsRow?.communicationsPolicy);
  const windowDays = (parsedPolicy.success ? parsedPolicy.data.workflowTexts?.renewalWindowDays : undefined) ?? 60;
  let stateProblem: string | null = null;
  if (agreement.status !== "ACTIVE") stateProblem = "This rental is not active.";
  else if (!agreement.termMonths || !agreement.endDate) stateProblem = "This rental is month to month, so it has no end date to mention.";
  else if (days! < 0) stateProblem = "This rental term already ended.";
  else if (days! > windowDays) stateProblem = `This rental term ends in more than ${windowDays} days. Try again closer to the end.`;
  return {
    principal: { customerId: agreement.customerId }, displayName: agreement.customer.user.name ?? "",
    rawPhone: phone.raw, phone: phone.phone,
    values: { name: firstNameFor(agreement.customer.user.name), date: agreement.endDate ? dateLabel(agreement.endDate) : "" },
    links: [{ entityType: "RentalAgreement", entityId: agreement.id }], stateProblem, convertedFromLeadId: null,
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
    case "RentalAgreement": return family.key === "renewal_heads_up" ? loadRenewal(tx, subjectId, now) : loadAgreement(tx, family, subjectId);
    case "Invoice": return loadInvoice(tx, family, subjectId);
    case "Job": return loadJob(tx, family, subjectId, now);
    case "MaintenanceRequest": return loadMaintenance(tx, family, subjectId);
    default: return null;
  }
}

/** Click-to-call (COM-N2): who the record belongs to and their saved phone. Not tied to any text wording. */
export async function loadCallSubject(
  tx: Tx, type: "Job" | "Lead" | "MaintenanceRequest", id: string, now: Date,
): Promise<LoadedSubject | null> {
  if (!id || id.length > 100) return null;
  const neutral = { key: "call", subject: type } as unknown as WorkflowTextFamily;
  if (type === "Lead") return loadLead(tx, id);
  if (type === "Job") return loadJob(tx, neutral, id, now);
  return loadMaintenance(tx, neutral, id);
}
