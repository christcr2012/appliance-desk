import type Stripe from "stripe";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { businessDateKey, businessDayBounds } from "@/lib/business-date";
import { recordSystemIssue, resolveSystemIssue } from "@/domains/system-issues";
import { postPending } from "./post";

const CURSOR_KEY = "stripe-balance-transactions";
const THREE_DAYS = 3 * 86_400;
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

/** We require a full page traversal before advancing the import cursor. */
export class StripeBooksEvidenceError extends Error {}

export type StripeBooksClient = Pick<Stripe, "balanceTransactions">;
export type StripeSyncResult = {
  state: "NOT_INITIALIZED" | "SYNCED";
  pages: number;
  transactions: number;
  cursor: number | null;
};

function seconds(date: Date) {
  return Math.floor(date.getTime() / 1000);
}
function safeCents(amount: number, label: string): number {
  if (!Number.isSafeInteger(amount)) throw new StripeBooksEvidenceError("Invalid Stripe " + label + " amount.");
  return amount;
}
function safeTime(value: number, label: string): Date {
  if (!Number.isSafeInteger(value) || value < 0 || value > 4_102_444_800)
    throw new StripeBooksEvidenceError("Invalid Stripe " + label + " timestamp.");
  return new Date(value * 1000);
}
function safeIdentifier(value: string, label: string) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value))
    throw new StripeBooksEvidenceError("Invalid Stripe " + label + " identifier.");
  return value;
}
function decodeTransaction(row: Stripe.BalanceTransaction) {
  const amount = safeCents(row.amount, "gross");
  const fee = safeCents(row.fee, "fee");
  const net = safeCents(row.net, "net");
  if (amount - fee !== net) throw new StripeBooksEvidenceError("Stripe gross, fee and net do not reconcile.");
  const currency = (row.currency ?? "").toLowerCase();
  if (currency !== "usd") throw new StripeBooksEvidenceError("Stripe transaction currency is not USD; owner review needed.");
  const type = safeIdentifier(row.type, "transaction type");
  const reportingCategory = safeIdentifier(row.reporting_category, "reporting category");
  const source = typeof row.source === "string" ? safeIdentifier(row.source, "source") : null;
  return {
    id: safeIdentifier(row.id, "transaction"),
    type,
    reportingCategory,
    amountCents: amount,
    feeCents: fee,
    netCents: net,
    currency,
    sourceId: source,
    payoutId: (type === "payout" || type === "payout_failure") ? source : null,
    description: typeof row.description === "string" ? row.description.slice(0, 500) : null,
    createdAtStripe: safeTime(row.created, "creation"),
    availableOn: safeTime(row.available_on, "availability"),
  };
}

/**
 * Read-only Stripe provider access, private database writes. Full traversal or no
 * cursor advance; committed pages are replayed by stable id on subsequent tries.
 * Do not call in a production environment until separately authorized by owner.
 */
export async function syncStripeBalanceTransactions(
  client?: StripeBooksClient,
): Promise<StripeSyncResult> {
  const settings = await prisma.businessSettings.findUnique({
    where: { id: "singleton" }, select: { booksStartDate: true },
  });
  if (!settings?.booksStartDate) return { state: "NOT_INITIALIZED", pages: 0, transactions: 0, cursor: null };
  const stripe = client ?? getStripeClient();
  const prior = await prisma.integrationCursor.findUnique({ where: { key: CURSOR_KEY } });
  const parsed = prior ? Number(prior.value) : null;
  if (prior && (!Number.isSafeInteger(parsed) || parsed! < 0))
    throw new StripeBooksEvidenceError("Stripe import cursor is invalid; do not skip unknown history.");

  // A new importer traverses from the books start; subsequent imports overlap.
  const from = Math.max(0, seconds(settings.booksStartDate),
    parsed === null ? 0 : parsed - THREE_DAYS);
  let lastId: string | undefined;
  let pages = 0, transactions = 0, newest = parsed ?? from;
  let complete = false;
  for (; pages < MAX_PAGES; ) {
    let page: Stripe.ApiList<Stripe.BalanceTransaction>;
    try {
      page = await stripe.balanceTransactions.list({
        created: { gte: from }, limit: PAGE_SIZE,
        ...(lastId ? { starting_after: lastId } : {}),
      });
    } catch {
      throw new StripeBooksEvidenceError("Stripe import failed; existing evidence is retained and the cursor was not advanced.");
    }
    if (!Array.isArray(page.data) || typeof page.has_more !== "boolean" ||
      page.data.length > PAGE_SIZE || (page.has_more && page.data.length === 0))
      throw new StripeBooksEvidenceError("Stripe returned incomplete pagination; cursor unchanged.");
    const checked = page.data.map(decodeTransaction);
    if (new Set(checked.map(row => row.id)).size !== checked.length)
      throw new StripeBooksEvidenceError("Stripe repeated an id within a page; cursor unchanged.");
    // Each page is atomic and independently recoverable; no partial row is saved.
    await prisma.$transaction(async tx => {
      for (const row of checked) {
        const existing = await tx.stripeBalanceTransaction.findUnique({ where: { id: row.id } });
        if (existing && (
          existing.type !== row.type || existing.reportingCategory !== row.reportingCategory ||
          existing.currency !== row.currency || existing.amountCents !== row.amountCents ||
          existing.feeCents !== row.feeCents || existing.netCents !== row.netCents ||
          existing.sourceId !== row.sourceId || existing.payoutId !== row.payoutId ||
          existing.createdAtStripe.getTime() !== row.createdAtStripe.getTime() ||
          existing.availableOn.getTime() !== row.availableOn.getTime()
        )) throw new StripeBooksEvidenceError("Previously recorded Stripe transaction changed; preserve books and review before importing.");
        await tx.stripeBalanceTransaction.upsert({
          where: { id: row.id }, create: row,
          update: { syncedAt: new Date() },
        });
      }
    }, { timeout: 30_000 });
    pages++;
    transactions += checked.length;
    for (const row of checked) newest = Math.max(newest, seconds(row.createdAtStripe));
    if (!page.has_more) { complete = true; break; }
    lastId = checked.at(-1)?.id;
    if (!lastId) throw new StripeBooksEvidenceError("Stripe pagination ended before has_more; cursor unchanged.");
  }
  if (!complete) throw new StripeBooksEvidenceError("Stripe history exceeds the bounded import; continue from the existing cursor after review.");

  await prisma.$transaction(async tx => {
    const stored = await tx.integrationCursor.findUnique({ where: { key: CURSOR_KEY } });
    const storedValue = stored ? Number(stored.value) : 0;
    if (stored && (!Number.isSafeInteger(storedValue) || storedValue < 0))
      throw new StripeBooksEvidenceError("Stripe cursor changed to invalid data; refusing overwrite.");
    await tx.integrationCursor.upsert({
      where: { key: CURSOR_KEY },
      create: { key: CURSOR_KEY, value: String(newest) },
      update: { value: String(Math.max(storedValue, newest)) },
    });
  });
  return { state: "SYNCED", pages, transactions, cursor: newest };
}

export type ClearingResult =
  | { state: "UNKNOWN"; reason: string; cutoff: Date }
  | { state: "MATCH" | "DIFFERENCE"; cutoff: Date; differenceCents: number };

/**
 * Never compare yesterday's journal to Stripe's live balance today.
 * Require a successful full import today and owner-attested opening evidence.
 */
export async function checkStripeClearing(now = new Date(), tx?:Prisma.TransactionClient, persistIssues=true): Promise<ClearingResult> {
  const db=tx??prisma;
  const todayStart = businessDayBounds(now).start;
  const cutoff = new Date(todayStart.getTime() - 1);
  const unknown = (reason: string): ClearingResult => ({ state: "UNKNOWN", reason, cutoff });
  const [settings, cursor] = await Promise.all([
    db.businessSettings.findUnique({ where: { id: "singleton" }, select: { booksStartDate: true } }),
    db.integrationCursor.findUnique({ where: { key: CURSOR_KEY } }),
  ]);
  if (!settings?.booksStartDate) return unknown("Books have not been initialized by the owner.");
  if (settings.booksStartDate > cutoff) return unknown("No completed accounting day since the books start.");
  if (!cursor || cursor.updatedAt < todayStart)
    return unknown("Stripe import has not completed for this Colorado day.");
  const opening = await db.journalEntry.findUnique({
    where: { sourceType_sourceId_eventKind: {
      sourceType: "OPENING", sourceId: businessDateKey(settings.booksStartDate), eventKind: "OPENING_BALANCE",
    } }, include: { lines: { include: { ledgerAccount: { select: { systemRole: true } } } } },
  });
  if (!opening) return unknown("Opening Stripe balance is not owner-attested.");
  const clearing = await db.ledgerAccount.findUnique({
    where: { systemRole: "STRIPE_CLEARING" }, select: { id: true },
  });
  if (!clearing) return unknown("Stripe clearing account is missing.");
  const unknownStripeRows = await db.stripeBalanceTransaction.count({
    where: {
      createdAtStripe: { gte: settings.booksStartDate, lte: cutoff },
      NOT: [{ type: { in: ["charge", "payment", "refund", "payment_refund", "transfer", "payout",
        "payout_failure", "stripe_fee", "tax_fee", "application_fee", "adjustment"] } }],
    },
  });
  if (unknownStripeRows) return unknown("Unrecognized Stripe transactions require owner review.");
  const openStripeIssues = await db.systemIssue.count({
    where: { kind: "BOOKS_POSTING_FAILURE", status: "OPEN",
      fingerprint: { startsWith: "books-post:STRIPE_BALANCE_TXN:" } },
  });
  if (openStripeIssues) return unknown("A Stripe source could not be posted; review Books.");
  const [imported, journal, pending] = await Promise.all([
    db.stripeBalanceTransaction.aggregate({
      where: { createdAtStripe: { gte: settings.booksStartDate, lte: cutoff } },
      _sum: { netCents: true },
    }),
    db.journalLine.aggregate({
      where: { ledgerAccountId: clearing.id, entry: { entryDate: { lte: cutoff } } },
      _sum: { debitCents: true, creditCents: true },
    }),
    db.stripeBalanceTransaction.findMany({
      where: { createdAtStripe: { gte: settings.booksStartDate, lte: cutoff } },
      select: { id: true, type: true, feeCents: true, reportingCategory: true },
      take: 10_000,
    }),
  ]);
  // An incomplete posting backlog must not be reported as reconciled or a confirmed gap.
  const expectedKinds = (row: typeof pending[number]) => {
    const kinds: string[] = [];
    if (row.feeCents && !["stripe_fee", "tax_fee", "application_fee"].includes(row.type)) kinds.push("STRIPE_FEE");
    if (["stripe_fee", "tax_fee", "application_fee"].includes(row.type)) kinds.push("STRIPE_SERVICE_FEE");
    if (row.type === "adjustment" && ["dispute", "dispute_reversal"].includes(row.reportingCategory)) kinds.push("STRIPE_DISPUTE");
    if (["payout", "payout_failure"].includes(row.type)) kinds.push("STRIPE_PAYOUT");
    return kinds;
  };
  if (pending.length === 10_000) return unknown("Stripe journal coverage exceeds the bounded daily review.");
  const journalEvidence = await db.journalEntry.findMany({
    where: { sourceType: "STRIPE_BALANCE_TXN", sourceId: { in: pending.map(x => x.id) } },
    select: { sourceId: true, eventKind: true },
  });
  const posted = new Set(journalEvidence.map(x => x.sourceId + ":" + x.eventKind));
  for (const row of pending) for (const kind of expectedKinds(row))
    if (!posted.has(row.id + ":" + kind)) return unknown("Stripe entries await journal posting.");

  // Opening-balance corrections are immutable difference journals. A correction
  // recorded within this cutoff must adjust BOTH the journal balance and the
  // Stripe comparison baseline, or a valid correction appears as a false gap.
  // Later-dated corrections do not affect an older reconciliation day.
  const corrections = await db.journalLine.aggregate({
    where: { ledgerAccountId: clearing.id, entry: {
      sourceType: "OPENING", sourceId: businessDateKey(settings.booksStartDate),
      eventKind: { startsWith: "OPENING_CORRECTED_" },
      entryDate: { lte: cutoff },
    } },
    _sum: { debitCents: true, creditCents: true },
  });
  const opened = opening.lines
    .filter(line => line.ledgerAccount.systemRole === "STRIPE_CLEARING")
    .reduce((sum, line) => sum + line.debitCents - line.creditCents, 0);
  const correctionCents = (corrections._sum.debitCents ?? 0) - (corrections._sum.creditCents ?? 0);
  const expected = opened + correctionCents + (imported._sum.netCents ?? 0);
  const actual = (journal._sum.debitCents ?? 0) - (journal._sum.creditCents ?? 0);
  if (![opened, correctionCents, expected, actual].every(Number.isSafeInteger))
    return unknown("Stripe reconciliation exceeds safe integer cents.");
  const differenceCents = actual - expected;
  const period = businessDateKey(cutoff);
  if (differenceCents !== 0) {
    if(!tx&&persistIssues)await recordSystemIssue({ kind: "BOOKS_STRIPE_CLEARING_DIFFERENCE", period, differenceCents });
    return { state: "DIFFERENCE", cutoff, differenceCents };
  }
  if(!tx&&persistIssues)await resolveSystemIssue("books-stripe-clearing:" + period, "SOURCE_SUCCEEDED");
  return { state: "MATCH", cutoff, differenceCents: 0 };
}

/** One bounded, replay-safe daily accounting pass; no Stripe money/write API. */
export async function runStripeBooksNightly(client?: StripeBooksClient, now = new Date()) {
  const sync = await syncStripeBalanceTransactions(client);
  if (sync.state === "NOT_INITIALIZED")
    return { sync, posted: 0, clearing: { state: "UNKNOWN" as const } };
  const posted = await postPending({ limit: 500 });
  const clearing = posted.problems.length
    ? { state: "UNKNOWN" as const, reason: "Some books sources still require review." }
    : await checkStripeClearing(now);
  return { sync, posted: posted.posted, problems: posted.problems.length, clearing };
}
