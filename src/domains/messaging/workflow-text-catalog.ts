import type { VariableRules } from "./sms-template";

/**
 * The text messages the desk can send about a lead, estimate, signature, job, maintenance request, bill,
 * renewal or refund. Wording here is only the STARTING wording the owner sees; a family can be sent only after the
 * owner approves wording (saved as an approved template revision) AND switches that family on. Nothing sends by itself:
 * a signed-in owner or admin previews the exact text and presses Send.
 *
 * Every body keeps the business name and "Reply STOP to opt out." so a first text is always identifiable.
 */
export type WorkflowTextGroup = "LEAD_ESTIMATE_SIGNATURE" | "JOB_MAINTENANCE" | "BILLING_RENEWAL";
export type WorkflowTextSubject =
  | "Lead" | "Estimate" | "RentalAgreement" | "Job" | "MaintenanceRequest" | "Invoice" | "CustomerNotice";

export type WorkflowTextFamily = {
  key: string;
  group: WorkflowTextGroup;
  label: string;
  /** One plain sentence: when you would send this. */
  when: string;
  subject: WorkflowTextSubject;
  defaultBody: string;
  variables: VariableRules;
  /** Collections, renewal and refund wording that a lawyer should read before real customers get it. */
  needsLegalReview?: boolean;
  /** One plain sentence on why a professional should read the wording first. */
  needsLegalReviewReason?: string;
  /** A STAFF member may send this one, but only for a job assigned to them. Owners and admins may always send it. */
  staffAssigned?: boolean;
};

export const REQUIRED_TEXT_FOOTER = /reply stop/i;
export const BUSINESS = "Robinson Appliance Rentals";

const NAME = { example: "Alex", maxLength: 16 };
const NUMBER = { example: "1042", maxLength: 6 };
const VISIT = { example: "delivery", maxLength: 24 };
const WHEN = { example: "Tue, Oct 27, 2:00 PM MDT", maxLength: 30 };
const AMOUNT = { example: "$1,250.00", maxLength: 12 };
const DATE = { example: "Nov 30, 2026", maxLength: 14 };
const LINK = { example: "https://example.test/estimate/abc123", maxLength: 75 };

export const WORKFLOW_TEXT_GROUP_LABELS: Record<WorkflowTextGroup, string> = {
  LEAD_ESTIMATE_SIGNATURE: "Leads, estimates and signatures",
  JOB_MAINTENANCE: "Jobs and maintenance",
  BILLING_RENEWAL: "Billing, renewals and refunds",
};

export const WORKFLOW_TEXT_FAMILIES: readonly WorkflowTextFamily[] = [
  {
    key: "lead_received", group: "LEAD_ESTIMATE_SIGNATURE", subject: "Lead",
    label: "We got your request",
    when: "After someone asks about a rental on the website or by phone, to say you have their request.",
    defaultBody: `${BUSINESS}: Hi {{name}}, thanks for asking about a rental. We got your request and will be in touch soon. Reply STOP to opt out.`,
    variables: { name: NAME },
  },
  {
    key: "estimate_ready", group: "LEAD_ESTIMATE_SIGNATURE", subject: "Estimate",
    label: "Your estimate is ready",
    when: "After you send an estimate, to point the customer to it.",
    defaultBody: `${BUSINESS}: Hi {{name}}, your estimate #{{number}} is ready to review: {{link}} Reply STOP to opt out.`,
    variables: { name: NAME, number: NUMBER, link: LINK },
  },
  {
    key: "estimate_reminder", group: "LEAD_ESTIMATE_SIGNATURE", subject: "Estimate",
    label: "Your estimate is still waiting",
    when: "When a sent estimate has had no answer for a few days.",
    defaultBody: `${BUSINESS}: Hi {{name}}, your estimate #{{number}} is still open: {{link}} Reply STOP to opt out.`,
    variables: { name: NAME, number: NUMBER, link: LINK },
  },
  {
    key: "signature_request", group: "LEAD_ESTIMATE_SIGNATURE", subject: "RentalAgreement",
    label: "Your agreement is ready to sign",
    when: "After you send a rental agreement for signature, to give the customer the signing page.",
    defaultBody: `${BUSINESS}: Hi {{name}}, please review and sign your rental agreement: {{link}} Reply STOP to opt out.`,
    variables: { name: NAME, link: LINK },
  },
  {
    key: "signature_reminder", group: "LEAD_ESTIMATE_SIGNATURE", subject: "RentalAgreement",
    label: "Your agreement still needs a signature",
    when: "When an agreement has been waiting for a signature for a few days.",
    defaultBody: `${BUSINESS}: Hi {{name}}, your rental agreement still needs your signature: {{link}} Reply STOP to opt out.`,
    variables: { name: NAME, link: LINK },
  },
  {
    key: "signature_received", group: "LEAD_ESTIMATE_SIGNATURE", subject: "RentalAgreement",
    label: "We got your signed agreement",
    when: "After a customer signs, to confirm you have it.",
    defaultBody: `${BUSINESS}: Hi {{name}}, thank you. We received your signed rental agreement. Reply STOP to opt out.`,
    variables: { name: NAME },
  },
  {
    key: "job_scheduled", group: "JOB_MAINTENANCE", subject: "Job", staffAssigned: true,
    label: "Your visit is scheduled",
    when: "After a delivery, pickup, installation or maintenance visit is put on the calendar.",
    defaultBody: `${BUSINESS}: Hi {{name}}, your {{visit}} is scheduled for {{when}}. Reply STOP to opt out.`,
    variables: { name: NAME, visit: VISIT, when: WHEN },
  },
  {
    key: "job_reminder", group: "JOB_MAINTENANCE", subject: "Job", staffAssigned: true,
    label: "Reminder of your visit",
    when: "Before a scheduled visit, to remind the customer.",
    defaultBody: `${BUSINESS}: Reminder: your {{visit}} is scheduled for {{when}}. Reply STOP to opt out.`,
    variables: { visit: VISIT, when: WHEN },
  },
  {
    key: "job_on_the_way", group: "JOB_MAINTENANCE", subject: "Job", staffAssigned: true,
    label: "We are on the way",
    when: "On the day of the visit, when the team is heading to the customer.",
    defaultBody: `${BUSINESS}: Our team is on the way for your {{visit}} today. Reply STOP to opt out.`,
    variables: { visit: VISIT },
  },
  {
    key: "job_completed", group: "JOB_MAINTENANCE", subject: "Job", staffAssigned: true,
    label: "Your visit is done",
    when: "After a visit is marked completed.",
    defaultBody: `${BUSINESS}: Your {{visit}} is complete. Thank you! Reply STOP to opt out.`,
    variables: { visit: VISIT },
  },
  {
    key: "maintenance_received", group: "JOB_MAINTENANCE", subject: "MaintenanceRequest",
    label: "We got your maintenance request",
    when: "After a customer reports a problem, to say you have it.",
    defaultBody: `${BUSINESS}: Hi {{name}}, we received your maintenance request and will be in touch soon. Reply STOP to opt out.`,
    variables: { name: NAME },
  },
  {
    key: "maintenance_resolved", group: "JOB_MAINTENANCE", subject: "MaintenanceRequest",
    label: "Your maintenance request is resolved",
    when: "After a maintenance request is marked resolved.",
    defaultBody: `${BUSINESS}: Hi {{name}}, your maintenance request has been resolved. Reply STOP to opt out.`,
    variables: { name: NAME },
  },
  {
    key: "invoice_ready", group: "BILLING_RENEWAL", subject: "Invoice",
    label: "Your invoice is ready",
    when: "After an invoice is issued, to point the customer to it (they sign in to view it).",
    defaultBody: `${BUSINESS}: Hi {{name}}, invoice #{{number}} is ready. Sign in to view it: {{link}} Reply STOP to opt out.`,
    variables: { name: NAME, number: NUMBER, link: LINK },
  },
  {
    key: "invoice_reminder", group: "BILLING_RENEWAL", subject: "Invoice", needsLegalReview: true,
    label: "Friendly reminder: invoice still open",
    when: "When an invoice is still unpaid. A courtesy reminder only; it is not a legal notice.",
    defaultBody: `${BUSINESS}: Hi {{name}}, a friendly reminder that invoice #{{number}} is still open: {{link}} Reply STOP to opt out.`,
    variables: { name: NAME, number: NUMBER, link: LINK },
    needsLegalReviewReason: "Payment-reminder wording can be treated as debt collection in some places.",
  },
  {
    key: "payment_received", group: "BILLING_RENEWAL", subject: "Invoice",
    label: "We received your payment",
    when: "After an invoice is fully paid.",
    defaultBody: `${BUSINESS}: Hi {{name}}, we received your payment for invoice #{{number}}. Thank you! Reply STOP to opt out.`,
    variables: { name: NAME, number: NUMBER },
  },
  {
    key: "refund_issued", group: "BILLING_RENEWAL", subject: "Invoice", needsLegalReview: true,
    label: "Your refund was issued",
    when: "After a refund is issued on an invoice (the latest refund on it is used).",
    defaultBody: `${BUSINESS}: Hi {{name}}, a refund of {{amount}} for invoice #{{number}} was issued. It can take several business days to show up. Reply STOP to opt out.`,
    variables: { name: NAME, number: NUMBER, amount: AMOUNT },
    needsLegalReviewReason: "Refund wording can create promises about timing; have it read before real use.",
  },
  {
    key: "renewal_heads_up", group: "BILLING_RENEWAL", subject: "RentalAgreement", needsLegalReview: true,
    label: "Your rental term ends soon",
    when: "A courtesy heads-up when a fixed-term rental is close to ending (you choose how many days before; starting value 60). It is not the renewal notice itself.",
    defaultBody: `${BUSINESS}: Hi {{name}}, your rental term ends on {{date}}. Call us if you would like to renew. Reply STOP to opt out.`,
    variables: { name: NAME, date: DATE },
    needsLegalReviewReason: "Renewal wording must not replace or contradict the agreement's own renewal terms.",
  },
];

export function workflowTextFamily(key: string): WorkflowTextFamily | undefined {
  return WORKFLOW_TEXT_FAMILIES.find((family) => family.key === key);
}

export function workflowFamiliesInGroup(group: WorkflowTextGroup): WorkflowTextFamily[] {
  return WORKFLOW_TEXT_FAMILIES.filter((family) => family.group === group);
}
