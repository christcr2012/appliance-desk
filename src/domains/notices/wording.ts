/**
 * The owner's own wording for the month-to-month notices (Batch B2, B2-10 and B2-12). Pure: no database, so the
 * settings screen can import it. The owner can edit these; a blank saved value means "use the starting draft".
 * The starting drafts are plain English and NOT legal advice: Chris approves the wording (IN-21) before customer
 * email is turned on, and a Colorado attorney should read it.
 */
export const WORDING_PLACEHOLDERS = [
  "customerName",
  "businessName",
  "businessPhone",
  "businessEmail",
  "noticeDays",
  "termsText",
  "changeDays",
  "boundaryDate",
  "monthlyTotal",
  "items",
] as const;
export type WordingPlaceholder = (typeof WORDING_PLACEHOLDERS)[number];

export const DEFAULT_TERMS_CHANGE_TEXT = [
  "Hello {customerName},",
  "",
  "This is a notice from {businessName} about the terms of your month-to-month rental. Your price and your late fees do not change.",
  "",
  "Starting {changeDays} days after this notice reaches you, you can end your rental by giving us {noticeDays} days of notice. The rental then ends on your next monthly billing date after that notice period. There is no fee for ending a month-to-month rental.",
  "",
  "The terms that will apply:",
  "{termsText}",
  "",
  "Questions? Call {businessPhone} or email {businessEmail}.",
].join("\n");

export const DEFAULT_ANNUAL_REMINDER_TEXT = [
  "Hello {customerName},",
  "",
  "This is a yearly reminder from {businessName}. Your rental ({items}) continues month to month at {monthlyTotal} a month (plus any sales tax). Another full year of your rental will be complete on {boundaryDate}.",
  "",
  "You can end it at any time, online on the “My rentals” page of your customer account or by contacting us, by giving {noticeDays} days of notice. There is no fee. If you do nothing, it simply continues.",
  "",
  "Questions? Call {businessPhone} or email {businessEmail}.",
].join("\n");

/** Names inside {braces} that are not on the list, so a typo is caught when the owner saves instead of in a customer's email. */
export function unknownPlaceholders(template: string): string[] {
  const known = new Set<string>(WORDING_PLACEHOLDERS);
  const found = new Set<string>();
  for (const match of template.matchAll(/\{([^{}]*)\}/g)) {
    if (!known.has(match[1]!)) found.add(match[0]);
  }
  return [...found];
}

export function fillWording(template: string, values: Partial<Record<WordingPlaceholder, string>>): string {
  return template.replace(/\{([^{}]*)\}/g, (whole, name: string) => {
    const value = (values as Record<string, string | undefined>)[name];
    return value === undefined ? whole : value;
  });
}
