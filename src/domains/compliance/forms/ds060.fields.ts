/**
 * CMP-4 — the DS 060 (Lessor's Personal Property Declaration Schedule)
 * field map.
 *
 * Read from the official Weld County PDF itself on 2026-10-27: pages
 * 0-1 are instructions, the form is pages 2-3. Section D's first table
 * (page 2) has four rows (quantity, complete description including
 * model/serial number, lease term, monthly rent, year acquired, sales
 * price or original installed cost, month/year first placed in
 * service); the row suffixes are irregular in the published form
 * ("1", "Row2", "2", "Row4") and are copied exactly. The tables on
 * page 3 (terminated leases, a second lessee table) are not mapped —
 * the complete itemized listing always rides the spreadsheet.
 *
 * The user column is a published-form quirk: "Name and Address of User"
 * is ONE field with two widgets (rows 1 and 3), so it can only ever
 * print one renter's name. The filler sets it only when every rented
 * unit in the snapshot shares that one renter; otherwise it stays
 * blank and the spreadsheet carries each unit's renter — a wrong name
 * on a county form is worse than a blank column. The declaration
 * block's FEIN/SSN field is deliberately NOT mapped (see ds056).
 */
export const DS060_FIELDS = {
  mailing: "A NAME AND MAILING ADDRESS Indicate any changes or correctionsRow1",
  propertyLocation: "BUSINESS NAME AND PHYSICAL LOCATION OF THE PERSONAL PROPERTY AS OF JANUARY 1 2022Row1",
  productOrService: "Product or Service ProvidedRow1",
  county: "County",
  ownerName: "NAME OF OWNER",
  phone: "PHONE NUMBER",
  userShared: "Name and Address of User",
} as const;

export const DS060_ROW_FIELDS = [
  {
    quantity: "Quantity1",
    description: "Complete Description including ModelSerial Number1",
    leaseTerm: "Lease Term FromTo1",
    monthlyRent: "Monthly Rent1",
    yearAcquired: "Year Acquired1",
    originalCost: "Sales Price or Original Installed Cost1",
    placedInService: "Month  Year First Placed into Service1",
  },
  {
    quantity: "QuantityRow2",
    description: "Complete Description including ModelSerial NumberRow2",
    leaseTerm: "Lease Term FromToRow2",
    monthlyRent: "Monthly RentRow2",
    yearAcquired: "Year AcquiredRow2",
    originalCost: "Sales Price or Original Installed CostRow2",
    placedInService: "Month  Year First Placed into ServiceRow2",
  },
  {
    quantity: "Quantity2",
    description: "Complete Description including ModelSerial Number2",
    leaseTerm: "Lease Term FromTo2",
    monthlyRent: "Monthly Rent2",
    yearAcquired: "Year Acquired2",
    originalCost: "Sales Price or Original Installed Cost2",
    placedInService: "Month  Year First Placed into Service2",
  },
  {
    quantity: "QuantityRow4",
    description: "Complete Description including ModelSerial NumberRow4",
    leaseTerm: "Lease Term FromToRow4",
    monthlyRent: "Monthly RentRow4",
    yearAcquired: "Year AcquiredRow4",
    originalCost: "Sales Price or Original Installed CostRow4",
    placedInService: "Month  Year First Placed into ServiceRow4",
  },
] as const;
