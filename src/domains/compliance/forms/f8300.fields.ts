/**
 * CMP-3 field map — Form 8300, page 1 of the vendored PDF. Part I is the
 * person the cash came from (name split last/first/MI, TIN comb field,
 * address, city, state comb, ZIP); Part III line 28 is the date the cash
 * was received and line 32a the total cash received; Part IV is the
 * business that received it. Positions read from the PDF; the filled
 * form is a draft the owner checks before filing through BSA E-Filing.
 */
const P = "topmostSubform[0].Page1[0]";
export const F8300_FIELDS = {
  lastName: `${P}.f1_01[0]`,
  firstName: `${P}.f1_02[0]`,
  middleInitial: `${P}.f1_03[0]`,
  tin: `${P}.Line6_CombField[0].f1_04[0]`,
  address: `${P}.f1_05[0]`,
  city: `${P}.f1_07[0]`,
  state: `${P}.Line10_CombField[0].f1_08[0]`,
  zip: `${P}.f1_09[0]`,
  country: `${P}.f1_10[0]`,
  dateReceived: `${P}.Line28_ReadOrder[0].Line28_CombField[0].f1_30[0]`,
  totalCash: `${P}.f1_34[0]`,
  businessName: `${P}.f1_48[0]`,
  businessEin: `${P}.Line36_CombField[0].f1_49[0]`,
  businessAddress: `${P}.f1_50[0]`,
  businessCity: `${P}.f1_52[0]`,
  businessState: `${P}.Line39_CombField[0].f1_53[0]`,
  businessZip: `${P}.f1_54[0]`,
} as const;
