/**
 * CMP-1: the field map for the official 2026 Form 1040-ES booklet
 * (forms/irs/f1040es_2026.pdf). The four payment vouchers sit on the last
 * two pages in reverse order (voucher 4 on page 14; vouchers 3, 2, 1 top to
 * bottom on page 15). Each voucher block has the same layout:
 *   amount | first name, last name, SSN | spouse row | address | city, state, ZIP
 * Field names below were read from the vendored PDF itself; the forms test
 * fails if any mapped name is missing from the file, so an IRS re-issue
 * with renamed fields stops loudly instead of filling the wrong boxes.
 */

const p15 = (n: number) => `topmostSubform[0].Page15[0].f15_${n}[0]`;
const p14 = (n: number) => `topmostSubform[0].Page14[0].f14_${n}[0]`;

export type VoucherFieldKey =
  | "amount"
  | "firstName"
  | "lastName"
  | "ssn"
  | "address"
  | "city"
  | "state"
  | "zip";

export const F1040ES_VOUCHER_FIELDS: Record<1 | 2 | 3 | 4, Record<VoucherFieldKey, string>> = {
  // Voucher 1 — due April 15 (page 15, bottom block: f15_29..f15_42)
  1: {
    amount: p15(29),
    firstName: p15(30),
    lastName: p15(31),
    ssn: p15(32),
    address: p15(36),
    city: p15(37),
    state: p15(38),
    zip: p15(39),
  },
  // Voucher 2 — due June 15 (page 15, middle block: f15_15..f15_28)
  2: {
    amount: p15(15),
    firstName: p15(16),
    lastName: p15(17),
    ssn: p15(18),
    address: p15(22),
    city: p15(23),
    state: p15(24),
    zip: p15(25),
  },
  // Voucher 3 — due September 15 (page 15, top block: f15_1..f15_14)
  3: {
    amount: p15(1),
    firstName: p15(2),
    lastName: p15(3),
    ssn: p15(4),
    address: p15(8),
    city: p15(9),
    state: p15(10),
    zip: p15(11),
  },
  // Voucher 4 — due January 15 (page 14 block: f14_1..f14_14)
  4: {
    amount: p14(1),
    firstName: p14(2),
    lastName: p14(3),
    ssn: p14(4),
    address: p14(8),
    city: p14(9),
    state: p14(10),
    zip: p14(11),
  },
};
