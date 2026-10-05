import { DEFAULT_TERMS_CHANGE_TEXT, fillWording } from "./wording";

/** The notice that tells a month-to-month customer the ending terms changed. Pure. */
export type TermsChangeInput = {
  customerName: string;
  noticeDays: number;
  termsText: string;
  changeDays: number;
  businessName: string;
  businessPhone: string;
  businessEmail: string;
  /** The owner's own wording; blank or missing uses the starting draft. */
  template?: string | null;
};

export function composeTermsChangeNotice(input: TermsChangeInput): { subject: string; body: string } {
  const template = input.template?.trim() ? input.template : DEFAULT_TERMS_CHANGE_TEXT;
  return {
    subject: `A change to the terms of your month-to-month rental with ${input.businessName}`,
    body: `Hello ${input.customerName},\n\n${fillWording(template, {
      customerName: input.customerName,
      businessName: input.businessName,
      businessPhone: input.businessPhone,
      businessEmail: input.businessEmail,
      noticeDays: String(input.noticeDays),
      terms: input.termsText.trim(),
      // The delivery date is not known yet, so say it the way it is true: counted from when the notice arrives.
      effectiveDate: `${input.changeDays} days after this notice reaches you`,
    })}`,
  };
}
