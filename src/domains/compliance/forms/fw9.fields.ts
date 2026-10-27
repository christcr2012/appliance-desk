/**
 * CMP-3 field map — Form W-9, page 1 of the vendored PDF. Line 1 is the
 * legal name, line 2 the business/disregarded-entity name; the address
 * block follows; Part I splits the SSN into its 3/2/4 boxes and the EIN
 * into its 2/7 boxes (positions read from the PDF).
 */
const P = "topmostSubform[0].Page1[0]";
export const W9_FIELDS = {
  legalName: `${P}.f1_01[0]`,
  businessName: `${P}.f1_02[0]`,
  address: `${P}.Address_ReadOrder[0].f1_07[0]`,
  cityStateZip: `${P}.Address_ReadOrder[0].f1_08[0]`,
  ssn1: `${P}.f1_11[0]`,
  ssn2: `${P}.f1_12[0]`,
  ssn3: `${P}.f1_13[0]`,
  ein1: `${P}.f1_14[0]`,
  ein2: `${P}.f1_15[0]`,
} as const;
