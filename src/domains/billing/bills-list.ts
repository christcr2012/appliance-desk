// AR-0b: read-only queries for the Money › Bills screen and the customer record's Bills section
// (docs/build-specs/screens/MONEY-BILLS.md section 3). Callers check the role first (OWNER/ADMIN); these never write.
import type { InvoiceStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addBusinessDays, businessDateFromKey, businessDayBounds, businessMonthBounds } from "@/lib/business-date";
import { BILL_TABS, billTabWhere, payPathFor, type BillTab, type PayPath } from "./bill-status";

export type { PayPath } from "./bill-status";
export type BillType = "rent" | "sale" | "other";
export type BillDuePreset = "this-month" | "last-month" | "last-30" | "custom";
export type BillSort = "due-asc" | "due-desc" | "owed-desc" | "customer-asc";

export type BillsParams = {
  status: BillTab;
  q?: string;
  type?: BillType[];
  due?: { preset: BillDuePreset; from?: string; to?: string };
  autopay?: "on" | "off";
  sort: BillSort;
  cursor?: string;
  /** The customer record's Bills section: only this customer's bills. */
  customerId?: string;
  /** Rows per "page" (default 50, KIT 5.1). */
  pageSize?: number;
};

export type BillRow = {
  id: string;
  number: number;
  customerId: string;
  customerName: string;
  companyName: string | null;
  forText: string;
  amountCents: number;
  owedCents: number;
  status: InvoiceStatus;
  dueDate: Date | null;
  paidCents: number;
  autopay: boolean;
  createdAt: Date;
  /** null = nothing to collect (paid, closed, draft, or an old FAILED status). */
  payPath: PayPath | null;
};

export const BILL_PAGE_SIZE = 50;
export const BILL_WINDOW_CAP = 500;
/**
 * "Most owed first" can't be ordered in Prisma (it is amount due minus amount paid), so it ranks every matching bill
 * from four small number columns, then reads full rows only for the window shown. This is only a runaway guard far
 * above any real bill count for one search (a business with 50,000 matching bills would see the newest ranked).
 */
const OWED_SORT_LIMIT = 50_000;

const monthName = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "long" });

const ROW_SELECT = {
  id: true,
  invoiceNumber: true,
  customerId: true,
  status: true,
  dueDate: true,
  amountDueCents: true,
  amountPaidCents: true,
  createdAt: true,
  agreementId: true,
  billingPeriodStart: true,
  saleKind: true,
  stripeInvoiceId: true,
  lineItems: { select: { description: true }, orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }], take: 1 },
  customer: {
    select: {
      companyName: true,
      stripeDefaultPaymentMethodId: true,
      user: { select: { name: true, email: true } },
    },
  },
} satisfies Prisma.InvoiceSelect;

type Selected = Prisma.InvoiceGetPayload<{ select: typeof ROW_SELECT }>;

/** What a bill is for, in a few words: "October rent", "Shop sale", or its first line. */
export function billForText(b: {
  agreementId: string | null;
  billingPeriodStart: Date | null;
  saleKind: string | null;
  firstLine?: string | null;
}): string {
  if (b.agreementId) return b.billingPeriodStart ? `${monthName.format(b.billingPeriodStart)} rent` : "Rent";
  if (b.saleKind) return "Shop sale";
  return b.firstLine?.trim() || "Bill";
}

function toRow(b: Selected): BillRow {
  const owedCents = Math.max(0, b.amountDueCents - b.amountPaidCents);
  return {
    id: b.id,
    number: b.invoiceNumber,
    customerId: b.customerId,
    customerName: b.customer.user.name ?? b.customer.user.email,
    companyName: b.customer.companyName,
    forText: billForText({ ...b, firstLine: b.lineItems[0]?.description }),
    amountCents: b.amountDueCents,
    owedCents,
    status: b.status,
    dueDate: b.dueDate,
    paidCents: b.amountPaidCents,
    autopay: b.customer.stripeDefaultPaymentMethodId != null,
    createdAt: b.createdAt,
    payPath: payPathFor({ status: b.status, owedCents, stripeInvoiceId: b.stripeInvoiceId, saleKind: b.saleKind }),
  };
}

function dueRange(due: BillsParams["due"], now: Date): { gte: Date; lt: Date } | null {
  if (!due) return null;
  if (due.preset === "this-month") {
    const month = businessMonthBounds(now);
    return { gte: month.start, lt: month.end };
  }
  if (due.preset === "last-month") {
    const thisMonth = businessMonthBounds(now);
    const last = businessMonthBounds(new Date(thisMonth.start.getTime() - 1));
    return { gte: last.start, lt: last.end };
  }
  if (due.preset === "last-30") {
    return { gte: addBusinessDays(now, -30), lt: businessDayBounds(now).end };
  }
  const from = due.from ? businessDateFromKey(due.from) : null;
  const to = due.to ? businessDateFromKey(due.to) : null;
  if (!from && !to) return null;
  return {
    gte: from ?? new Date(0),
    lt: to ? addBusinessDays(to, 1) : new Date(8.64e15),
  };
}

/** Every filter except the status tab (the tab counts share these). */
export function billFilterWhere(params: Omit<BillsParams, "status" | "sort">, now: Date): Prisma.InvoiceWhereInput[] {
  const and: Prisma.InvoiceWhereInput[] = [];
  if (params.customerId) and.push({ customerId: params.customerId });
  const q = params.q?.trim().slice(0, 80);
  if (q) {
    if (/^\d+$/.test(q)) {
      const number = Number(q);
      and.push(Number.isSafeInteger(number) && number <= 2_147_483_647 ? { invoiceNumber: number } : { id: "" });
    } else {
      and.push({
        OR: [
          { customer: { user: { name: { contains: q, mode: "insensitive" } } } },
          { customer: { user: { email: { contains: q, mode: "insensitive" } } } },
          { customer: { companyName: { contains: q, mode: "insensitive" } } },
        ],
      });
    }
  }
  const types = [...new Set(params.type ?? [])];
  if (types.length > 0 && types.length < 3) {
    and.push({
      OR: types.map((type): Prisma.InvoiceWhereInput =>
        type === "rent"
          ? { agreementId: { not: null } }
          : type === "sale"
            ? { agreementId: null, saleKind: { not: null } }
            : { agreementId: null, saleKind: null },
      ),
    });
  }
  const range = dueRange(params.due, now);
  if (range) and.push({ dueDate: range });
  if (params.autopay === "on") and.push({ customer: { stripeDefaultPaymentMethodId: { not: null } } });
  if (params.autopay === "off") and.push({ customer: { stripeDefaultPaymentMethodId: null } });
  return and;
}

function where(params: BillsParams, now: Date): Prisma.InvoiceWhereInput {
  return { AND: [billTabWhere(params.status, now), ...billFilterWhere(params, now)] };
}

// ---- Cursor (KIT 5.1): base64url JSON of the last row shown; "Load more" grows the window. ----

type CursorValue = { v: string | null; n: number };

export function encodeBillCursor(value: CursorValue): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function decodeBillCursor(raw: string | undefined): CursorValue | null {
  if (!raw || raw.length > 400) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const { v, n } = parsed as { v?: unknown; n?: unknown };
    if (!(v === null || typeof v === "string") || typeof n !== "number" || !Number.isSafeInteger(n)) return null;
    return { v, n };
  } catch {
    return null;
  }
}

function orderBy(sort: Exclude<BillSort, "owed-desc">): Prisma.InvoiceOrderByWithRelationInput[] {
  switch (sort) {
    case "due-asc":
      return [{ dueDate: { sort: "asc", nulls: "last" } }, { invoiceNumber: "asc" }];
    case "due-desc":
      return [{ dueDate: { sort: "desc", nulls: "last" } }, { invoiceNumber: "desc" }];
    case "customer-asc":
      return [{ customer: { user: { name: { sort: "asc", nulls: "last" } } } }, { invoiceNumber: "asc" }];
  }
}

function sortValue(sort: Exclude<BillSort, "owed-desc">, b: Selected): string | null {
  if (sort === "customer-asc") return b.customer.user.name;
  return b.dueDate ? b.dueDate.toISOString() : null;
}

/** Rows at or before the cursor row in this order (nulls sort last in every order). */
function atOrBefore(sort: Exclude<BillSort, "owed-desc">, cursor: CursorValue): Prisma.InvoiceWhereInput {
  const asc = sort !== "due-desc";
  const number = asc ? { lte: cursor.n } : { gte: cursor.n };
  if (sort === "customer-asc") {
    const name = (filter: Prisma.StringNullableFilter | null): Prisma.InvoiceWhereInput => ({ customer: { user: { name: filter } } });
    return cursor.v === null
      ? { OR: [name({ not: null }), { AND: [name(null), { invoiceNumber: number }] }] }
      : { OR: [name({ lt: cursor.v }), { AND: [name({ equals: cursor.v }), { invoiceNumber: number }] }] };
  }
  if (cursor.v === null) return { OR: [{ dueDate: { not: null } }, { dueDate: null, invoiceNumber: number }] };
  const at = new Date(cursor.v);
  if (!Number.isFinite(at.getTime())) return { id: "" };
  return { OR: [{ dueDate: asc ? { lt: at } : { gt: at } }, { dueDate: at, invoiceNumber: number }] };
}

function windowSize(through: number, pageSize: number): number {
  return Math.min(through + pageSize, BILL_WINDOW_CAP);
}

/**
 * One window of bills. Without a cursor: the first page. With a cursor: every row from the start through the cursor
 * row, plus the next page after it, capped at 500 rows (then `capped` is true and there is no next cursor).
 */
export async function getBills(
  params: BillsParams,
  now = new Date(),
): Promise<{ rows: BillRow[]; nextCursor: string | null; capped: boolean }> {
  const pageSize = Math.max(1, Math.min(params.pageSize ?? BILL_PAGE_SIZE, BILL_PAGE_SIZE));
  const base = where(params, now);
  const cursor = decodeBillCursor(params.cursor);

  if (params.sort === "owed-desc") {
    const all = await prisma.invoice.findMany({
      where: base,
      select: { id: true, invoiceNumber: true, amountDueCents: true, amountPaidCents: true },
      orderBy: [{ invoiceNumber: "desc" }],
      take: OWED_SORT_LIMIT,
    });
    const owed = (b: { amountDueCents: number; amountPaidCents: number }) => Math.max(0, b.amountDueCents - b.amountPaidCents);
    const ordered = [...all].sort((a, b) => owed(b) - owed(a) || b.invoiceNumber - a.invoiceNumber);
    const through = cursor ? ordered.findIndex((b) => b.invoiceNumber === cursor.n) + 1 : 0;
    const limit = windowSize(through, pageSize);
    const ids = ordered.slice(0, limit).map((b) => b.id);
    const found = ids.length ? await prisma.invoice.findMany({ where: { id: { in: ids } }, select: ROW_SELECT }) : [];
    const byId = new Map(found.map((b) => [b.id, b]));
    const shown = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    const more = ordered.length > limit;
    const capped = more && limit >= BILL_WINDOW_CAP;
    const last = shown.at(-1);
    return {
      rows: shown.map(toRow),
      nextCursor: more && !capped && last ? encodeBillCursor({ v: String(owed(last)), n: last.invoiceNumber }) : null,
      capped,
    };
  }

  const sort = params.sort;
  const through = cursor ? await prisma.invoice.count({ where: { AND: [base, atOrBefore(sort, cursor)] } }) : 0;
  const limit = windowSize(through, pageSize);
  const fetched = await prisma.invoice.findMany({ where: base, select: ROW_SELECT, orderBy: orderBy(sort), take: limit + 1 });
  const shown = fetched.slice(0, limit);
  const more = fetched.length > limit;
  const capped = more && limit >= BILL_WINDOW_CAP;
  const last = shown.at(-1);
  return {
    rows: shown.map(toRow),
    nextCursor: more && !capped && last ? encodeBillCursor({ v: sortValue(sort, last), n: last.invoiceNumber }) : null,
    capped,
  };
}

/** How many bills each status tab holds with the same search and filters (one count per tab). */
export async function getBillCounts(
  params: Omit<BillsParams, "status">,
  now = new Date(),
): Promise<Record<BillTab, number>> {
  const filters = billFilterWhere(params, now);
  const counts = await Promise.all(
    BILL_TABS.map((tab) => prisma.invoice.count({ where: { AND: [billTabWhere(tab, now), ...filters] } })),
  );
  return Object.fromEntries(BILL_TABS.map((tab, index) => [tab, counts[index]])) as Record<BillTab, number>;
}

/** The summary line: how many bills match and how much is still owed on them. */
export async function getBillTotals(params: BillsParams, now = new Date()): Promise<{ count: number; owedCents: number }> {
  const result = await prisma.invoice.aggregate({
    where: where(params, now),
    _count: { _all: true },
    _sum: { amountDueCents: true, amountPaidCents: true },
  });
  const owed = (result._sum.amountDueCents ?? 0) - (result._sum.amountPaidCents ?? 0);
  const owing = params.status === "open" || params.status === "past-due";
  return { count: result._count._all, owedCents: owing ? Math.max(0, owed) : 0 };
}
