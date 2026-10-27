/**
 * CMP-2 — the DR 0104EP (2026) payment-voucher field map.
 *
 * Read from the official PDF itself on 2026-10-27: the booklet's pages
 * are instructions (0–1), the estimated-tax worksheet (2), a blank page
 * (3), the fillable payment voucher (4) and a blank page (5). One
 * voucher serves all four quarters — the year is printed on it and the
 * quarter is identified by the payment date. Every name below is the
 * AcroForm field name exactly as the state published it; the engine
 * refuses to fill when a mapped field is missing.
 */
export const DR0104EP_VOUCHER_FIELDS = {
  lastName: "Last Name",
  firstName: "First Name",
  middleInitial: "Middle Initial",
  ssn: "SSN or ITIN",
  address: "Street Address",
  city: "City",
  state: "State",
  zip: "ZIP Code",
  amount: "Amount of Payment",
} as const;
