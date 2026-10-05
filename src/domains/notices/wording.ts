/**
 * The owner's own wording for the month-to-month notices (Batch B2, B2-10 and B2-12). Pure: no database, so the
 * settings screen can import it. The owner can edit these; a blank saved value means "use the starting draft".
 * The starting drafts are plain English and NOT legal advice: Chris approves the wording (IN-21) before customer
 * email is turned on, and a Colorado attorney should read it.
 */
export const WORDING_PLACEHOLDERS = [
  "businessName",
  "businessPhone",
  "businessEmail",
  "noticeDays",
  "terms",
  "effectiveDate",
  "boundaryDate",
  "years",
  "monthlyTotal",
  "items",
  "customerName",
] as const;
export type WordingPlaceholder = (typeof WORDING_PLACEHOLDERS)[number];

/** The starting drafts. They are word for word what the migration saved for the owner (docs/designs/BATCH-B2.md). */
export const DEFAULT_TERMS_CHANGE_TEXT =
  "Starting {{effectiveDate}}, these terms will apply to your month-to-month rental with {{businessName}}: {{terms}} You need at least {{noticeDays}} days' notice to end a month-to-month rental. Fixed-term leases (6 or 12 months) are not affected by this change. You can end your rental at any time from the \"My rentals\" page of your customer account, or by contacting us at {{businessPhone}} or {{businessEmail}}.";

export const DEFAULT_ANNUAL_REMINDER_TEXT =
  "Your month-to-month rental with {{businessName}} ({{items}}) continues automatically each month at {{monthlyTotal}} a month plus any sales tax. On {{boundaryDate}} it will have been rented continuously for {{years}} year(s). You don't need to do anything to keep it. To end it, use the \"My rentals\" page of your customer account or contact us at {{businessPhone}} or {{businessEmail}}; your rental then ends on the first billing date at least {{noticeDays}} days later.";

const TOKEN = /\{\{\s*([A-Za-z]+)\s*\}\}/g;

/** Names inside {{double braces}} that are not on the list, so a typo is caught when the owner saves instead of in a customer's email. */
export function unknownPlaceholders(template: string): string[] {
  const known = new Set<string>(WORDING_PLACEHOLDERS);
  const found = new Set<string>();
  for (const match of template.matchAll(TOKEN)) {
    if (!known.has(match[1]!)) found.add(match[0]);
  }
  return [...found];
}

export function fillWording(template: string, values: Partial<Record<WordingPlaceholder, string>>): string {
  return template.replace(TOKEN, (whole, name: string) => {
    const value = (values as Record<string, string | undefined>)[name];
    return value === undefined ? whole : value;
  });
}
