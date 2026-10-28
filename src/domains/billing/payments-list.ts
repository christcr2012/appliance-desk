// AR-3 (MONEY-AREA 2): read-only queries for the Money › Payments list. Callers check the role first
// (OWNER/ADMIN); these never write. Pagination follows the KIT 5.1 cursor rule: order by (sort column, id),
// the cursor names the last row shown, and "Load more" grows the window from the start.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDayBounds, businessMonthBounds } from "@/lib/business-date";
import { paymentTabWhere, type PaymentTab } from "./payment-tabs";

export type PaymentWhenPreset = "this-month" | "last-month" | "last-30" | "custom";
export type PaymentSort = "newest" | "oldest" | "amount-desc";

export type PaymentsParams = {
  status: PaymentTab;
  q?: string;
  method?: string[];
  when?: { preset: PaymentWhenPreset; from?: string; to?: string };
  sort: PaymentSort;
  cursor?: string;
  pageSize?: number;
};

export type PaymentRow = {
  id: string;
  createdAt: Date;
  amountCents: number;
  method: string | null;
  status: string;
  failureReason: string | null;
  invoiceId: string;
  invoiceNumber: number;
  customerId: string;
  customerName: string;
  companyName: string | null;
};

export type PaymentCounts = { received: number; failed: number; held: number; receivedSumCents: number };

export const PAYMENT_PAGE_SIZE = 50;
export const PAYMENT_WINDOW_CAP = 500;

const DAY_MS = 86_400_000;

const ROW_SELECT = {
  id: true,
  createdAt: true,
  amountCents: true,
  method: true,
  status: true,
  failureReason: true,
  invoice: {
    select: {
      id: true,
      invoiceNumber: true,
      customerId: true,
      customer: { select: { companyName: true, user: { select: { name: true, email: true } } } },
    },
  },
} satisfies Prisma.PaymentSelect;

type PaymentRecord = Prisma.PaymentGetPayload<{ select: typeof ROW_SELECT }>;

const toRow = (payment: PaymentRecord): PaymentRow => ({
  id: payment.id,
  createdAt: payment.createdAt,
  amountCents: payment.amountCents,
  method: payment.method,
  status: payment.status,
  failureReason: payment.failureReason,
  invoiceId: payment.invoice.id,
  invoiceNumber: payment.invoice.invoiceNumber,
  customerId: payment.invoice.customerId,
  customerName: payment.invoice.customer.user.name ?? payment.invoice.customer.user.email,
  companyName: payment.invoice.customer.companyName,
});

function whenWhere(when: PaymentsParams["when"], now: Date): Prisma.PaymentWhereInput | null {
  if (!when) return null;
  const month = businessMonthBounds(now);
  switch (when.preset) {
    case "this-month":
      return { createdAt: { gte: month.start } };
    case "last-month": {
      const last = businessMonthBounds(new Date(month.start.getTime() - 1));
      return { createdAt: { gte: last.start, lt: month.start } };
    }
    case "last-30":
      return { createdAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } };
    case "custom": {
      const range: Prisma.DateTimeFilter = {};
      const from = when.from ? businessDateFromKey(when.from) : null;
      const to = when.to ? businessDateFromKey(when.to) : null;
      if (from) range.gte = businessDayBounds(from).start;
      if (to) range.lt = businessDayBounds(to).end;
      return Object.keys(range).length ? { createdAt: range } : null;
    }
  }
}

/** The filters every tab shares (search, method, when). Status is applied per tab. */
function sharedWhere(params: PaymentsParams, now: Date): Prisma.PaymentWhereInput {
  const parts: Prisma.PaymentWhereInput[] = [];
  if (params.method?.length) parts.push({ method: { in: params.method } });
  const when = whenWhere(params.when, now);
  if (when) parts.push(when);
  const q = params.q?.trim();
  if (q) {
    if (/^\d+$/.test(q)) {
      parts.push({ invoice: { invoiceNumber: Number(q) } });
    } else {
      parts.push({
        invoice: {
          customer: {
            OR: [
              { user: { name: { contains: q, mode: "insensitive" } } },
              { user: { email: { contains: q, mode: "insensitive" } } },
              { companyName: { contains: q, mode: "insensitive" } },
            ],
          },
        },
      });
    }
  }
  return parts.length ? { AND: parts } : {};
}

function withTab(params: PaymentsParams, now: Date): Prisma.PaymentWhereInput {
  const tab = paymentTabWhere(params.status);
  const shared = sharedWhere(params, now);
  return tab ? { AND: [shared, tab] } : shared;
}

// ---- Cursor (KIT 5.1): base64url JSON { v, id } of the last row shown. ----
type CursorValue = { v: string; id: string };

export function encodePaymentCursor(value: CursorValue): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodePaymentCursor(raw: string | undefined): CursorValue | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as CursorValue;
    return typeof parsed?.v === "string" && typeof parsed?.id === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function orderBy(sort: PaymentSort): Prisma.PaymentOrderByWithRelationInput[] {
  switch (sort) {
    case "oldest":
      return [{ createdAt: "asc" }, { id: "asc" }];
    case "amount-desc":
      return [{ amountCents: "desc" }, { id: "desc" }];
    case "newest":
      return [{ createdAt: "desc" }, { id: "desc" }];
  }
}

/** Rows at or before the cursor row in the sort order (how far the window already reaches). */
function atOrBeforeWhere(sort: PaymentSort, cursor: CursorValue): Prisma.PaymentWhereInput {
  if (sort === "amount-desc") {
    const amount = Number(cursor.v);
    return { OR: [{ amountCents: { gt: amount } }, { amountCents: amount, id: { gte: cursor.id } }] };
  }
  const at = new Date(cursor.v);
  return sort === "newest"
    ? { OR: [{ createdAt: { gt: at } }, { createdAt: at, id: { gte: cursor.id } }] }
    : { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lte: cursor.id } }] };
}

const cursorOf = (sort: PaymentSort, row: PaymentRow): CursorValue => ({
  v: sort === "amount-desc" ? String(row.amountCents) : row.createdAt.toISOString(),
  id: row.id,
});

export async function getPayments(
  params: PaymentsParams,
  now = new Date(),
): Promise<{ rows: PaymentRow[]; nextCursor: string | null; capped: boolean }> {
  const pageSize = params.pageSize ?? PAYMENT_PAGE_SIZE;
  const where = withTab(params, now);
  const cursor = decodePaymentCursor(params.cursor);
  const through = cursor
    ? await prisma.payment.count({ where: { AND: [where, atOrBeforeWhere(params.sort, cursor)] } })
    : 0;
  const windowSize = Math.min(through + pageSize, PAYMENT_WINDOW_CAP);
  const found = await prisma.payment.findMany({
    where,
    select: ROW_SELECT,
    orderBy: orderBy(params.sort),
    take: windowSize + 1,
  });
  const rows = found.slice(0, windowSize).map(toRow);
  const hasMore = found.length > windowSize;
  return {
    rows,
    nextCursor: hasMore && rows.length ? encodePaymentCursor(cursorOf(params.sort, rows[rows.length - 1])) : null,
    capped: hasMore && windowSize >= PAYMENT_WINDOW_CAP,
  };
}

/** One count per status tab over the shared filters, plus the received total for the summary line. */
export async function getPaymentCounts(params: PaymentsParams, now = new Date()): Promise<PaymentCounts> {
  const shared = sharedWhere(params, now);
  const countFor = (tab: PaymentTab) => {
    const tabWhere = paymentTabWhere(tab);
    return prisma.payment.count({ where: tabWhere ? { AND: [shared, tabWhere] } : shared });
  };
  const [received, failed, held, receivedSum] = await Promise.all([
    countFor("received"),
    countFor("failed"),
    countFor("held"),
    prisma.payment.aggregate({
      where: { AND: [shared, paymentTabWhere("received")!] },
      _sum: { amountCents: true },
    }),
  ]);
  return { received, failed, held, receivedSumCents: receivedSum._sum.amountCents ?? 0 };
}
