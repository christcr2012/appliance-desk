/**
 * V-2: does the business deliver to this address? A pure rule over the owner's own service-area lists (Settings).
 * No outside lookup, no storage: the answer is only as good as those two lists.
 *
 *   INVALID  the street address is empty/too short, or the ZIP code is not five digits
 *   SERVED   the ZIP code is in the service-area ZIP list, or (when the owner lists no ZIP codes) the city is in the city list
 *   NOT_YET  anything else
 */
export type AddressCheckStatus = "SERVED" | "NOT_YET" | "INVALID";
export type AddressCheckInput = { line1: string; zip: string; city?: string };
export type AddressCheckResult = { status: AddressCheckStatus; zip?: string; city?: string };
export type ServiceAreaLists = { cities: ReadonlyArray<string>; zips: ReadonlyArray<string> };

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** The five digits of a US ZIP code ("80634", "80634-1234", " 80634 "), or null. */
export function normalizeZip(raw: string): string | null {
  const match = /^(\d{5})(?:[-\s]?\d{4})?$/.exec(collapse(raw));
  return match ? match[1] : null;
}

export function checkServiceArea(input: AddressCheckInput, area: ServiceAreaLists): AddressCheckResult {
  const line1 = collapse(input.line1 ?? "");
  const zip = normalizeZip(input.zip ?? "");
  if (line1.length < 3 || !zip) return { status: "INVALID" };
  const zips = new Set(area.zips.map((z) => normalizeZip(String(z))).filter((z): z is string => z !== null));
  if (zips.has(zip)) return { status: "SERVED", zip };
  const city = collapse(input.city ?? "").toLowerCase();
  if (zips.size === 0 && city) {
    const known = area.cities.map((c) => collapse(String(c)).toLowerCase());
    if (known.includes(city)) return { status: "SERVED", zip, city: collapse(input.city ?? "") };
  }
  return { status: "NOT_YET", zip };
}
