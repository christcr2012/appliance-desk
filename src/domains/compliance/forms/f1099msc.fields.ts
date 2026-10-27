/**
 * CMP-3 field map — Form 1099-MISC (2026), Copy B (for recipient), page 4
 * of the vendored PDF (index 3). The left column matches the 1099-NEC
 * layout field for field (verified against the PDF); the right column's
 * Box 1 (rents) is the first money field and Box 3 (other income) carries
 * the IRS "Box3_ReadOrder" name in the PDF itself.
 */
export const MISC_COPY_B_PAGE = 3;
const L = "topmostSubform[0].CopyB[0].LeftColumn[0]";
const R = "topmostSubform[0].CopyB[0].RightColumn[0]";
export const MISC_COPY_B_FIELDS = {
  calendarYear: "topmostSubform[0].CopyB[0].CopyHeader[0].CalendarYear[0].f2_1[0]",
  payerName: `${L}.f2_2[0]`,
  payerStreet: `${L}.f2_3[0]`,
  payerSuite: `${L}.f2_4[0]`,
  payerCity: `${L}.f2_5[0]`,
  payerPhone: `${L}.f2_6[0]`,
  payerState: `${L}.f2_7[0]`,
  payerCountry: `${L}.f2_8[0]`,
  payerZip: `${L}.f2_9[0]`,
  payerTin: `${L}.f2_10[0]`,
  recipientTin: `${L}.f2_11[0]`,
  recipientName: `${L}.f2_12[0]`,
  recipientStreet: `${L}.f2_13[0]`,
  recipientSuite: `${L}.f2_14[0]`,
  recipientCity: `${L}.f2_15[0]`,
  recipientState: `${L}.f2_16[0]`,
  recipientCountry: `${L}.f2_17[0]`,
  recipientZip: `${L}.f2_18[0]`,
  accountNumber: `${L}.f2_19[0]`,
  box1: `${R}.f2_20[0]`,
  box3: `${R}.Box3_ReadOrder[0].f2_22[0]`,
} as const;
