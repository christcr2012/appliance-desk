import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { recordSystemIssue } from "@/domains/system-issues";
import { businessDateFromKey } from "@/lib/business-date";
import { writeJournal, postPending } from "@/domains/books/post";
import { openingBalance, receiptReceived, balancedPlan } from "@/domains/books/posting-rules";
import {
  syncStripeBalanceTransactions, checkStripeClearing,
  type StripeBooksClient, StripeBooksEvidenceError,
} from "@/domains/books/stripe-balance";

const tag = randomUUID().replace(/-/g, "").slice(0, 10);
const prefix = "txn_books_" + tag;
const startDate = "2026-10-16";
const start = businessDateFromKey(startDate)!;
const today = new Date("2026-10-18T12:00:00.000Z");
const beforeCutoff = Math.floor(new Date("2026-10-17T20:00:00.000Z").getTime() / 1000);
const afterCutoff = Math.floor(new Date("2026-10-18T09:00:00.000Z").getTime() / 1000);
let oldStart: Date | null = null;
let oldCursor: { value: string } | null = null;

function transaction(suffix: string, amount: number, fee: number, created = beforeCutoff,
  type = "charge", reporting = "charge") {
  return {
    id: prefix + "_" + suffix, amount, fee, net: amount - fee,
    currency: "usd", type, reporting_category: reporting,
    created, available_on: created, source: "ch_" + tag + suffix,
    description: "Synthetic transaction",
  } as unknown as Stripe.BalanceTransaction;
}
function fake(pages: Array<Stripe.BalanceTransaction[] | Error>) {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    balanceTransactions: {
      list: async (args: Record<string, unknown>) => {
        calls.push(args);
        const page = pages[calls.length - 1] ?? [];
        if (page instanceof Error) throw page;
        return { data: page, has_more: calls.length < pages.length };
      },
    },
  } as unknown as StripeBooksClient;
  return { client, calls };
}
beforeAll(async () => {
  const settings = await prisma.businessSettings.findUnique({ where: { id: "singleton" } });
  oldStart = settings?.booksStartDate ?? null;
  const cursor = await prisma.integrationCursor.findUnique({ where: { key: "stripe-balance-transactions" } });
  oldCursor = cursor ? { value: cursor.value } : null;
  await prisma.businessSettings.upsert({ where: { id: "singleton" },
    create: { id: "singleton", booksStartDate: start },
    update: { booksStartDate: start } });
  const plan = openingBalance({ date: start, stripeCents: 500, bankCents: 0, cardCents: 0 });
  if (!plan) throw Error("Invalid opening fixture");
  await prisma.$transaction(tx => writeJournal(tx, "OPENING", startDate, "OPENING_BALANCE", plan));
  await prisma.integrationCursor.deleteMany({ where: { key: "stripe-balance-transactions" } });
});
afterAll(async () => {
  const sourceIds = [startDate, prefix + "_receipt"];
  await prisma.journalLine.deleteMany({ where: { entry: {
    OR: [{ sourceId: { in: sourceIds } }, { sourceType: "STRIPE_BALANCE_TXN", sourceId: { startsWith: prefix } }],
  } } });
  await prisma.journalEntry.deleteMany({ where: {
    OR: [{ sourceId: { in: sourceIds } }, { sourceType: "STRIPE_BALANCE_TXN", sourceId: { startsWith: prefix } }],
  } });
  await prisma.stripeBalanceTransaction.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.systemIssue.deleteMany({ where: { fingerprint: { in: [
    "books-stripe-clearing:2026-10-17", "books-post:STRIPE_BALANCE_TXN:" + prefix + "_unknown",
    "books-post:STRIPE_BALANCE_TXN:" + prefix + "_fee",
  ] } } });
  if (oldCursor) await prisma.integrationCursor.upsert({ where: { key: "stripe-balance-transactions" },
    create: { key: "stripe-balance-transactions", value: oldCursor.value },
    update: { value: oldCursor.value } });
  else await prisma.integrationCursor.deleteMany({ where: { key: "stripe-balance-transactions" } });
  await prisma.businessSettings.update({ where: { id: "singleton" }, data: { booksStartDate: oldStart } });
});
describe("K-3 provider evidence to Stripe clearing", () => {
  it("keeps cursor unchanged after a failed second page, replays earlier pages by stable id", async () => {
    const first = transaction("first", 1000, 30, afterCutoff);
    const failed = fake([[first], new Error("synthetic provider failure")]);
    await expect(syncStripeBalanceTransactions(failed.client)).rejects.toBeInstanceOf(StripeBooksEvidenceError);
    expect(await prisma.stripeBalanceTransaction.count({ where: { id: first.id } })).toBe(1);
    expect(await prisma.integrationCursor.findUnique({ where: { key: "stripe-balance-transactions" } })).toBeNull();
    const retry = fake([[first], []]);
    const success = await syncStripeBalanceTransactions(retry.client);
    expect(success.state).toBe("SYNCED");
    expect(success.pages).toBe(2);
    expect((retry.calls[0].created as { gte: number }).gte).toBe(Math.floor(start.getTime() / 1000));
    expect(retry.calls[1].starting_after).toBe(first.id);
    expect(await prisma.stripeBalanceTransaction.count({ where: { id: first.id } })).toBe(1);
    expect((await prisma.integrationCursor.findUnique({ where: { key: "stripe-balance-transactions" } }))?.value)
      .toBe(String(afterCutoff));
    const again = fake([[first]]);
    await syncStripeBalanceTransactions(again.client);
    expect((again.calls[0].created as { gte: number }).gte).toBe(afterCutoff - 3 * 86400 > Math.floor(start.getTime() / 1000)
      ? afterCutoff - 3 * 86400 : Math.floor(start.getTime() / 1000));
  });
  it("refuses inconsistent cents and foreign currency without advancing cursor", async () => {
    const prior = (await prisma.integrationCursor.findUnique({ where: { key: "stripe-balance-transactions" } }))!.value;
    const broken = { ...transaction("bad", 100, 1), net: 100 } as Stripe.BalanceTransaction;
    await expect(syncStripeBalanceTransactions(fake([[broken]]).client))
      .rejects.toThrow(/gross, fee and net/);
    const euro = { ...transaction("euro", 100, 1), currency: "eur" } as Stripe.BalanceTransaction;
    await expect(syncStripeBalanceTransactions(fake([[euro]]).client))
      .rejects.toThrow(/not USD/);
    expect((await prisma.integrationCursor.findUnique({ where: { key: "stripe-balance-transactions" } }))?.value)
      .toBe(prior);
    const stable = transaction("immutable", 500, 15, afterCutoff);
    await syncStripeBalanceTransactions(fake([[stable]]).client);
    const modified = { ...stable, amount: 501, net: 486 } as Stripe.BalanceTransaction;
    await expect(syncStripeBalanceTransactions(fake([[modified]]).client))
      .rejects.toThrow(/Previously recorded Stripe transaction changed/);
    expect((await prisma.stripeBalanceTransaction.findUnique({ where: { id: stable.id } }))?.amountCents)
      .toBe(500);
  });
  it("uses one cutoff; later receipts do not fake mismatches, real cent gaps are reviewable", async () => {
    // Existing opening is 500 cents, no older Stripe transaction yet.
    expect((await checkStripeClearing(today)).state).toBe("MATCH");
    // A BA-2 owner correction changes the clearing account AND the attested
    // opening amount, not the provider's transaction history.
    const revised = balancedPlan(start, "Corrected opening Stripe balance", [
      {role:"STRIPE_CLEARING",debitCents:125,creditCents:0},
      {role:"OWNER_CONTRIBUTIONS",debitCents:0,creditCents:125},
    ])!;
    await prisma.$transaction(tx=>writeJournal(tx,"OPENING",startDate,"OPENING_CORRECTED_1",revised));
    const corrected = await checkStripeClearing(today);
    expect(corrected.state).toBe("MATCH");
    if(corrected.state==="MATCH")expect(corrected.differenceCents).toBe(0);
    const gap = transaction("gap", 1, 0);
    await syncStripeBalanceTransactions(fake([[gap]]).client);
    const result = await checkStripeClearing(today);
    expect(result.state).toBe("DIFFERENCE");
    if (result.state === "DIFFERENCE") expect(result.differenceCents).toBe(-1);
    expect(await prisma.systemIssue.count({ where: { fingerprint: "books-stripe-clearing:2026-10-17" } })).toBe(1);
    await prisma.$transaction(tx => writeJournal(tx, "RECEIPT", prefix + "_receipt",
      "RECEIPT_RECEIVED", receiptReceived({ date: new Date(gap.created * 1000),
        amountCents: 1, method: "STRIPE" })!));
    expect((await checkStripeClearing(today)).state).toBe("MATCH");
    expect((await prisma.systemIssue.findUnique({ where: { fingerprint: "books-stripe-clearing:2026-10-17" } }))?.status)
      .toBe("RESOLVED");
  });
  it("posts Stripe fees, service charges, disputes and payouts only once under replay", async () => {
    const fee = transaction("fee", 1000, 25);
    const service = transaction("service", -12, 0, beforeCutoff, "stripe_fee", "stripe_fee");
    const dispute = transaction("dispute", -60, 0, beforeCutoff, "adjustment", "dispute");
    const payout = transaction("payout", -400, 0, beforeCutoff, "payout", "payout");
    const refunded = transaction("refund", -50, 0, beforeCutoff, "refund", "refund");
    await syncStripeBalanceTransactions(fake([[fee, service, dispute, payout, refunded]]).client);
    await recordSystemIssue({ kind: "BOOKS_POSTING_FAILURE", sourceType: "STRIPE_BALANCE_TXN", sourceId: fee.id });
    await Promise.allSettled([postPending({ limit: 500 }), postPending({ limit: 500 })]);
    const verified = await postPending({ limit: 500 });
    expect(verified.problems.filter(x=>x.sourceType==="STRIPE_BALANCE_TXN"&&x.sourceId===fee.id)).toEqual([]);
    expect((await prisma.systemIssue.findUnique({ where: { fingerprint: "books-post:STRIPE_BALANCE_TXN:" + fee.id } }))?.status)
      .toBe("RESOLVED");
    const rows = await prisma.journalEntry.findMany({ where: {
      sourceType: "STRIPE_BALANCE_TXN",
      sourceId: { in: [fee.id, service.id, dispute.id, payout.id, refunded.id] },
    }, include: { lines: true } });
    expect(rows.map(x => x.eventKind).sort()).toEqual([
      "STRIPE_DISPUTE", "STRIPE_FEE", "STRIPE_PAYOUT", "STRIPE_SERVICE_FEE",
    ]);
    for (const row of rows)
      expect(row.lines.reduce((sum, line) => sum + line.debitCents - line.creditCents, 0)).toBe(0);
    expect(await prisma.journalEntry.count({ where: {
      sourceType: "STRIPE_BALANCE_TXN", sourceId: refunded.id,
    } })).toBe(0);
  });
  it("does not invent unknown Stripe accounting postings", async () => {
    const row = transaction("unknown", 85, 0, beforeCutoff, "unrecognized_kind", "other");
    await syncStripeBalanceTransactions(fake([[row]]).client);
    const posted = await postPending({ limit: 500 });
    expect(posted.problems.some(p => p.sourceType === "STRIPE_BALANCE_TXN" && p.sourceId === row.id)).toBe(true);
    expect(await prisma.journalEntry.count({ where: { sourceType: "STRIPE_BALANCE_TXN", sourceId: row.id } })).toBe(0);
    expect((await checkStripeClearing(today)).state).toBe("UNKNOWN");
  });
});
