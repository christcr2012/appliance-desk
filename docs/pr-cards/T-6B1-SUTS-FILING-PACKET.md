# T-6b1 — SUTS filing packet and use-tax worksheet

Base branch: final reviewed T-6a2 · Risk area: filing money correctness · Migration: none · Budget estimate: ~500 production lines / <14 files
Design: `docs/designs/BATCH-T.md` sections 3.5–3.6, 11.4–11.5, 11.8 (reasons only — this card is the build spec)

## Read only these (in this order)
1. `prisma/schema.prisma` — `InvoiceTaxLine`, `TaxFilingAccount`, `TaxFilingPeriod`, `PurchaseUseTax`.
2. `src/domains/tax/engine.ts`, `src/domains/tax/categories.ts` — tax categories only.
3. `src/domains/reports/accounting-export.ts` or the current receipt/allocation query used to distinguish cash vs accrual timing; do not invent payment allocation.
4. `src/domains/tax/allocate.ts` — deterministic cents conventions.
5. BATCH-T 3.5–3.6 and 11.4 filing-packet + 11.5 only.

## Before you start
- T-6a2 is merged and filing periods/accounts exist.
- IN-35 may still be open. `basis = UNDECIDED` must block totals rather than guess cash/accrual.
- IN-44 may still be open. Missing deduction labels warn; they never change stored customer tax.

## Build

### Use-tax recording and filing-period assignment
Create `src/domains/tax/use-tax.ts` and make this PR the owner of BATCH-T 3.6's use-tax rows. T-6d later calls this function from appliance intake; purchase-order receiving and Batch K use the same seam.

```ts
export async function recordUseTaxForPurchase(
  tx: Prisma.TransactionClient,
  input: {
    sourceType: "APPLIANCE" | "PURCHASE_ORDER_LINE" | "EXPENSE";
    sourceId: string;
    purchasedOn: Date;
    amountCents: number;
    vendorTaxCents: number;
    isRentalInventory: boolean;
  },
): Promise<void>;

export async function assignDueUseTaxRowsToPeriod(
  tx: Prisma.TransactionClient,
  filingPeriodId: string,
): Promise<number>;
```

`recordUseTaxForPurchase` uses the current business-location `AddressTaxLocation`. For each jurisdiction, compute expected tax from the applicable non-undone rate version, allocate vendor tax proportionally across jurisdictions with the existing deterministic allocator, and store `max(0, expected - allocatedVendorTax)`. Status is `NOT_DUE` when the amount is zero, or when `isRentalInventory` and the election is `COLLECT_ON_RENTALS`; otherwise `DUE`. It is idempotent on `(sourceType, sourceId, jurisdictionId)`: cost/tax changes update an unfiled row; changing a FILED row is left for T-6b2's amendment detector.

When a jurisdiction has `useTaxFilingAccountId` and an OPEN period for that account contains `purchasedOn`, set `filingPeriodId` while recording. If the period does not exist yet, leave it null. `assignDueUseTaxRowsToPeriod` is the catch-up path: row-lock the target period, require `filingAccount.kind = USE_TAX_RETURN`, and attach every unassigned `DUE` row whose jurisdiction points to that filing account and whose `purchasedOn` falls inside the period. Never steal a row already assigned to another period.

`loadFilingPacket(periodId)` must call `assignDueUseTaxRowsToPeriod` transactionally before reading use-tax rows, so a valid DUE row can never disappear from the return merely because its period was created after the purchase row.

### Filing packet
Create `src/domains/tax/filing-packet.ts`:
```ts
export type FilingPacketRow = {
  jurisdictionId: string;
  name: string;
  filingCode: string | null;
  administration: "STATE_COLLECTED" | "SELF_COLLECTED";
  grossSalesCents: number;
  deductions: { key: string; label: string; cents: number }[];
  netTaxableCents: number;
  rateMilliPercent: number;
  taxCents: number;
  serviceFeeCents: number;
  remitCents: number;
};

export type FilingPacket = {
  account: {
    id: string;
    name: string;
    kind: "SALES_RETURN" | "USE_TAX_RETURN";
    accountNumber: string | null;
    portalUrl: string | null;
  };
  periodStart: string;
  periodEnd: string;
  dueOn: string;
  legalDueOn: string;
  basis: "ACCRUAL" | "CASH";
  zeroReturn: boolean;
  rows: FilingPacketRow[];
  useTax: {
    jurisdictionId: string;
    name: string;
    filingCode: string | null;
    purchaseCents: number;
    useTaxCents: number;
  }[];
  totals: {
    taxCents: number;
    serviceFeeCents: number;
    remitIfOnTimeCents: number;
    remitIfLateCents: number;
    remitCents: number;
  };
  steps: string[];
  warnings: string[];
};

export type FilingPacketLoad =
  | { status: "READY"; packet: FilingPacket }
  | { status: "BLOCKED"; problems: string[] };

export function buildFilingPacket(input: {
  account: FilingPacket["account"] & {
    deductionLabels: unknown;
  };
  period: { start: Date; end: Date; dueOn: Date; legalDueOn: Date };
  basis: "ACCRUAL" | "CASH";
  rows: FilingPacketRow[];
  useTax: FilingPacket["useTax"];
  viewedOn: Date;
}): FilingPacket;

export async function loadFilingPacket(
  periodId: string,
  now?: Date,
): Promise<FilingPacketLoad>;
```

Rules:
- OWNER/ADMIN may load; STAFF/CUSTOMER may not.
- Accrual uses invoice/tax-line date; cash uses the existing receipt-allocation evidence. Do not infer cash collection from invoice status.
- Per-jurisdiction `taxCents` is the sum of stored `InvoiceTaxLine.taxCents`, never recomputed from rate × taxable.
- Split rows by rate version when a rate changed during the period.
- Gross excludes deposits and tax.
- Stable deduction keys: `EXEMPT_SHORT_TERM_RENTAL`, `EXEMPT_CUSTOMER_<reason>`, `NOT_TAXED_CATEGORY`, `OUTSIDE_AREA`.
- `deductionLabels[key]` is `{label, reportAs: "DEDUCTION" | "LEAVE_OUT_OF_GROSS"}`; missing mappings display “Not decided — ask your CPA” and add a warning.
- Service fee is zero unless configured; calculate per row from collected tax. Packet carries on-time and late totals. `remitCents` follows the viewing date vs `legalDueOn`.
- Use-tax rows come from the `recordUseTaxForPurchase` / `assignDueUseTaxRowsToPeriod` seam above. The packet includes every `PurchaseUseTax.status = DUE` row assigned or catch-up-assigned to the period; it does not invent tax beyond that persisted evidence.
- Zero-return packet is valid when there is no reportable sale/use tax.
- Steps follow BATCH-T 11.5 and use account/filing labels; they do not invent authenticated SUTS field names.
- Rounding warning explains stored per-bill tax vs once-per-period math; never changes the stored tax.

## Tests
- `tests/tax-filing-packet.test.ts`: accrual/cash; zero return; deduction buckets; missing-label warning; SUTS row order; mid-period rate split; stored-tax rounding; on-time service fee; late no-fee; totals.
- ★ `tests/tax-filing-integration.test.ts`: load from real invoices/tax lines/receipt allocations; OWNER/ADMIN allowed; STAFF refused; use-tax row lands on USE_TAX_RETURN account.
- ★ `tests/tax-use-tax-integration.test.ts`: records expected-minus-vendor tax for the business jurisdictions; proportional vendor-tax allocation is deterministic; COLLECT_ON_RENTALS rental inventory is NOT_DUE; repeated source updates are idempotent; an existing OPEN USE_TAX_RETURN period is assigned immediately; a row created before its period is catch-up-assigned when the packet loads; a row already assigned to another period is never stolen.

## Commands
- `npm run typecheck 2>&1 | tail -40`
- `npm run lint 2>&1 | tail -40`
- `npx vitest run tests/tax-filing-packet.test.ts tests/tax-filing-integration.test.ts tests/tax-use-tax-integration.test.ts 2>&1 | tail -100`

## Stop and ask if
- Cash-basis evidence would require guessing payment allocation.
- SUTS requires a number not derivable from stored invoice/tax/use-tax evidence.
- A deduction would change tax due instead of only return presentation.

## Done when
- [ ] packet totals reconcile exactly to stored tax evidence
- [ ] no cash/accrual or deduction policy is guessed
- [ ] use tax is included only from existing DUE evidence
- [ ] no filing mutation or screen is added
- [ ] `docs/STATUS.md` updated; review threads dispositioned
