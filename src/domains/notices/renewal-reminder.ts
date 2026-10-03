import { formatCents } from "@/domains/pricing/money";
import { formatBusinessDate } from "@/lib/business-date";

/**
 * The reminder a customer must get before an automatic renewal (Colorado's
 * automatic-renewal law asks for it 25 to 40 days before the renewal). Pure: no
 * database. The facts (dates, price) come from the agreement; the renewal wording
 * is the owner's own text that THIS agreement was signed with, repeated word for
 * word, so the notice can never promise anything different from what was agreed.
 */
export type RenewalReminderInput = {
  customerName: string;
  termMonths: number;
  termEndDate: Date;
  renewalStartDate: Date;
  monthlyTotalCents: number;
  lineLabels: string[];
  renewalTermsText: string;
  businessName: string;
  businessPhone: string;
  businessEmail: string;
};

export function composeRenewalReminder(input: RenewalReminderInput): { subject: string; body: string } {
  const lastDay = formatBusinessDate(input.termEndDate);
  const startDay = formatBusinessDate(input.renewalStartDate);
  const items = input.lineLabels.join(", ");
  const subject = `Your rental renews automatically after ${lastDay}`;
  const body = [
    `Hello ${input.customerName},`,
    "",
    `This is a reminder from ${input.businessName}. Your ${input.termMonths}-month rental (${items}) ends on ${lastDay}.`,
    `You chose automatic renewal, so unless you cancel it, your rental will continue month to month starting ${startDay} at ${formatCents(input.monthlyTotalCents)} a month (plus any sales tax). Nothing changes about your equipment.`,
    "",
    "The renewal terms you agreed to:",
    input.renewalTermsText.trim(),
    "",
    `To stop the renewal, turn off automatic renewal on the “My rentals” page of your customer account, or contact us before ${lastDay}: ${input.businessPhone} or ${input.businessEmail}.`,
  ].join("\n");
  return { subject, body };
}

export const renewalReminderKey = (agreementId: string, termEndDate: Date) =>
  `renewal-reminder-${agreementId}-${termEndDate.toISOString().slice(0, 10)}`;
