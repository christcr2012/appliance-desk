// OPS-6: checks owner-edited notice wording. This file lists the forbidden phrases, so tests/ops6-no-ownership-wording.test.ts skips it.
// Wording Chris can edit must never drift into ownership or purchase-option language (that would bring Colorado's
// rental-purchase law). The same patterns are checked by tests/ops6-no-ownership-wording.test.ts.
const OWNERSHIP_WORDING = [
  /rent[- ]to[- ]own/i, /lease[- ]to[- ]own/i, /rental[- ]purchase/i, /purchase option/i, /option to (buy|purchase)/i,
  /(buy|purchase)[- ]?out\b/i, /you (will|may|can) (own|keep) (it|the (appliance|washer|dryer|unit))/i,
  /ownership (passes|transfers|will transfer) to (you|the customer|the renter)/i,
  /after (the )?(last|final) payment[^.]{0,40}\b(own|yours|belongs to you)/i, /(appliance|machine|unit) (becomes|will become) yours/i,
];
export const MAX_WORDING_CHARS = 600;

/** A plain-English problem with a piece of notice wording, or null when it is fine to save. Empty means "use the recommended text". */
export function wordingProblem(text: string): string | null {
  if (text.length > MAX_WORDING_CHARS) return `Keep it under ${MAX_WORDING_CHARS} characters.`;
  if (OWNERSHIP_WORDING.some((p) => p.test(text))) return "That wording suggests the customer will own the appliance. Rentals here never do, so please rephrase it.";
  if (/\b(collection agency|on behalf of|lawsuit will be filed|arrest|jail|garnish)/i.test(text)) return "Notices must come from the business itself and must not threaten. Please rephrase it.";
  return null;
}
