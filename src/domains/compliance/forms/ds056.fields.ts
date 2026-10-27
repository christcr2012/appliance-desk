/**
 * CMP-4 — the DS 056 (Personal Property Declaration Schedule) field map.
 *
 * Read from the official Weld County PDF itself on 2026-10-27: pages 0-1
 * are instructions, the form is pages 2-3. Section D's additions table
 * (page 2) has five complete rows (item id, quantity, description, year
 * acquired, original installed cost, month/year first placed in
 * service); the original-cost fields are named OIC1, OIC12..OIC15 in row
 * order (paired by their vertical positions). The tables continuing on
 * page 3 belong to other sections (expensed/leased-in property) and are
 * not mapped — the complete itemized listing always rides the
 * spreadsheet, exactly as the form's own Section D instructs. The
 * declaration block's FEIN/SSN field is deliberately NOT mapped: the app
 * never prints the owner's tax id onto a downloaded draft; he writes it
 * when he signs. Every name below is the AcroForm field name exactly as
 * the county published it; the engine refuses to fill when a mapped
 * field is missing.
 */
export const DS056_FIELDS = {
  mailing: "A NAME AND MAILING ADDRESS Indicate any changes or correctionsRow1",
  propertyLocation: "BUSINESS NAME AND PHYSICAL LOCATION OF THE PERSONAL PROPERTY AS OF JANUARY 1 2022Row1",
  productOrService: "Product or Service ProvidedRow1",
  county: "County",
  ownerName: "NAME OF OWNER",
  phone: "PHONE NUMBER",
  newBusiness:
    "NEW BUSINESSORGANIZATION  You must give a complete itemized listing of all personal property  Use the first part of Section D",
} as const;

export const DS056_ROW_FIELDS = [
  {
    itemId: "Item IDRow1",
    quantity: "QuantityRow1",
    description: "Description Including Model or CapacityRow1",
    yearAcquired: "Year AcquiredRow1",
    originalCost: "OIC1",
    placedInService: "Mo Yr First Placed into Service",
  },
  {
    itemId: "Item IDRow2",
    quantity: "QuantityRow2",
    description: "Description Including Model or CapacityRow2",
    yearAcquired: "Year AcquiredRow2",
    originalCost: "OIC12",
    placedInService: "Mo Yr First Placed into Service_2",
  },
  {
    itemId: "Item IDRow3",
    quantity: "QuantityRow3",
    description: "Description Including Model or CapacityRow3",
    yearAcquired: "Year AcquiredRow3",
    originalCost: "OIC13",
    placedInService: "Mo Yr First Placed into Service_3",
  },
  {
    itemId: "Item IDRow4",
    quantity: "QuantityRow4",
    description: "Description Including Model or CapacityRow4",
    yearAcquired: "Year AcquiredRow4",
    originalCost: "OIC14",
    placedInService: "Mo Yr First Placed into Service_4",
  },
  {
    itemId: "Item IDRow5",
    quantity: "QuantityRow5",
    description: "Description Including Model or CapacityRow5",
    yearAcquired: "Year AcquiredRow5",
    originalCost: "OIC15",
    placedInService: "Mo Yr First Placed into Service_5",
  },
] as const;
