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
};

export const REQUIRED_TEXT_FOOTER = /reply stop/i;
export const BUSINESS = "Robinson Appliance Rentals";

const NAME = { example: "Alex", maxLength: 16 };
const NUMBER = { example: "1042", maxLength: 6 };
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
];

export function workflowTextFamily(key: string): WorkflowTextFamily | undefined {
  return WORKFLOW_TEXT_FAMILIES.find((family) => family.key === key);
}

export function workflowFamiliesInGroup(group: WorkflowTextGroup): WorkflowTextFamily[] {
  return WORKFLOW_TEXT_FAMILIES.filter((family) => family.group === group);
}
