import { businessDateFromKey, businessDateKey } from "@/lib/business-date";

/**
 * TFA-2 §10: the Colorado sales tax license runs to December 31 of odd
 * years (the dated rule `co.license.expiry`). Pure date helpers on Denver
 * business-date keys, like the rest of the tax calendar.
 */

function day(key: string): Date {
  const date = businessDateFromKey(key);
  if (!date) throw new Error("Could not resolve Colorado calendar date: " + key);
  return date;
}

/** The license expiry in force on `now`: Dec 31 of the current odd year, or of the next one once that has passed. */
export function licenseDefaultExpiry(now: Date): Date {
  const year = Number(businessDateKey(now).slice(0, 4));
  const oddYear = year % 2 === 1 ? year : year + 1;
  return day(`${oddYear}-12-31`);
}

/** After a renewal, the expiry rolls to the next odd year's Dec 31 after the current one. */
export function nextLicenseExpiry(current: Date): Date {
  const key = businessDateKey(current);
  let year = Number(key.slice(0, 4));
  if (year % 2 === 0) year += 1;
  if (`${year}-12-31` <= key) year += 2;
  return day(`${year}-12-31`);
}
