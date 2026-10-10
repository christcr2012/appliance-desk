import { randomUUID } from "node:crypto";
import { Prisma, type TelecomSyncResource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { reportedTelecomSpend, telecomDecimal } from "./telecom-decimal";
import { makeTwilioReadAdapter, type TelecomReadAdapter, type TelecomReadPage } from "@/lib/communications/providers/twilio-read";

export type TelecomSyncInput = {
  accountId: string; resource: TelecomSyncResource; windowStart: Date; windowEnd: Date;
  now?: Date; maxPages?: number; adapter?: TelecomReadAdapter;
};
export type TelecomSyncResult = {
  pages: number; records: number; unknownPrices: number;
  completed: boolean; nextPageToken: string | null;
};
const KNOWN_ERRORS = ["TELECOM_UNCONFIGURED", "PROVIDER_ACCOUNT_MISMATCH",
  "PROVIDER_COUNTRY_MISMATCH", "INVALID_PROVIDER_DATA", "INVALID_PROVIDER_CURSOR",
  "INVALID_PROVIDER_DATE", "PROVIDER_PAGE_TOO_LARGE", "TELECOM_RATE_LIMITED",
  "TELECOM_PROVIDER_UNAVAILABLE", "INVALID_NUMBER_ID", "INVALID_SYNC_WINDOW",
  "STALE_TELECOM_CLAIM"];
function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return KNOWN_ERRORS.includes(message) ? message : "TELECOM_READ_FAILED";
}

async function persistObservedPage(
  tx: Prisma.TransactionClient, accountId: string, page: TelecomReadPage, at: Date,
): Promise<number> {
  let unknown = 0;
  if (page.kind === "USAGE") {
    for (const row of page.items) {
      const startDate = new Date(row.startDate + "T00:00:00Z");
      const endDate = new Date(row.endDate + "T00:00:00Z");
      const present = await tx.telecomUsageSnapshot.findFirst({
        where: { accountId, category: row.category, startDate, endDate, payloadHash: row.hash },
        select: { id: true },
      });
      if (present) continue;
      await tx.telecomUsageSnapshot.create({ data: {
        accountId, category: row.category, startDate, endDate,
        count: telecomDecimal(row.count), countUnit: row.countUnit,
        usage: telecomDecimal(row.usage), usageUnit: row.usageUnit,
        price: row.price === null ? null : telecomDecimal(row.price),
        currency: row.currency, providerAsOf: at, providerSource: "twilio:usage",
        isTotal: row.isTotal, payloadHash: row.hash,
      } });
      if (row.price === null) unknown++;
    }
  } else if (page.kind === "READINESS") {
    const r = page.items[0];
    if (!r) throw new Error("INVALID_PROVIDER_DATA");
    await tx.telecomAccount.update({ where: { id: accountId }, data: {
      checkedAt: at, readiness: {
        providerAccountStatus: r.accountStatus,
        primaryNumberConfirmed: r.numberConfirmed,
        observedVoiceCapability: r.voice, observedSmsCapability: r.sms,
        providerCheckedAt: at.toISOString(), a2pApprovalVerified: false,
      },
    } });
  } else if (page.kind === "PRICING") {
    for (const r of page.items) {
      const existing = await tx.telecomRateVersion.findFirst({
        where: { accountId, service: r.service, component: r.component,
          destinationKey: r.destinationKey, source: "PRICING_API",
          currency: r.currency, rate: telecomDecimal(r.rate), effectiveUntil: null },
      });
      if (existing) continue;
      const prior = await tx.telecomRateVersion.findFirst({
        where: { accountId, service: r.service, component: r.component,
          destinationKey: r.destinationKey, source: "PRICING_API", effectiveUntil: null },
        orderBy: { effectiveFrom: "desc" }, select: { id: true },
      });
      if (prior) await tx.telecomRateVersion.update({
        where: { id: prior.id }, data: { effectiveUntil: at },
      });
      await tx.telecomRateVersion.create({ data: {
        accountId, service: r.service, category: r.category,
        destinationCountry: r.destinationCountry, destinationPrefix: r.destinationPrefix,
        destinationKey: r.destinationKey, senderType: r.senderType,
        component: r.component, rate: telecomDecimal(r.rate),
        currency: r.currency, unit: r.unit, source: "PRICING_API",
        effectiveFrom: at, fetchedAt: at, completeness: { basicRateOnly: true },
      } });
    }
  } else {
    for (const r of page.items) {
      if (r.price === null || r.currency === null) { unknown++; continue; }
      const type = page.kind === "MESSAGES" ? "message" : "call";
      const prefix = type + ":" + r.sid + ":";
      const amount = reportedTelecomSpend(r.price, "TWILIO_RESOURCE");
      if (!amount) { unknown++; continue; }
      const classification = "PROVIDER_REPORTED";
      const match = type === "message" ? await tx.messageAttempt.findFirst({
        where: { accountId, providerResourceId: r.sid }, select: { id: true },
      }) : await tx.callLeg.findFirst({
        where: { accountId, providerCallId: r.sid }, select: { id: true },
      });
      // Only the same provider resource, account, basis, component and
      // currency can supersede an earlier observation. Unmatched is unallocated.
      const previous = await tx.communicationCostFact.findFirst({
        where: { accountId, classification, component: type, currency: r.currency,
          sourceKey: { startsWith: prefix }, supersededBy: null },
        select: { id: true, amount: true, quantity: true, unit: true },
      });
      const quantity = r.quantity === null ? null : telecomDecimal(r.quantity);
      if (previous && previous.amount.equals(amount) &&
          (previous.quantity === null ? quantity === null : quantity !== null && previous.quantity.equals(quantity)) &&
          previous.unit === r.unit) continue;
      const sourceKey = prefix + (previous?.id ?? "initial") + ":" + amount.toFixed(10) + ":" + r.currency;
      await tx.communicationCostFact.create({ data: {
        accountId, sourceKey, component: type, classification, amount,
        currency: r.currency, occurredAt: new Date(r.occurredAt),
        quantity,
        unit: r.unit, providerAsOf: at, supersedesId: previous?.id,
        ...(type === "message" ? { messageAttemptId: match?.id } : { callLegId: match?.id }),
      } });
    }
  }
  return unknown;
}

/** One durable claim, one provider GET at a time; commits a checkpoint with each page. */
export async function syncTelecomUsage(input: TelecomSyncInput): Promise<TelecomSyncResult> {
  const { accountId, resource, windowStart, windowEnd } = input;
  const now = input.now ?? new Date();
  const maxPages = input.maxPages ?? 3;
  if (![now, windowStart, windowEnd].every(d => d instanceof Date && Number.isFinite(+d)) ||
      windowStart >= windowEnd || +windowEnd - +windowStart > 370 * 86400_000 ||
      !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 8) throw new Error("INVALID_SYNC_WINDOW");
  const account = await prisma.telecomAccount.findUnique({
    where: { id: accountId }, select: {
      id: true, provider: true, environment: true, externalAccountId: true,
      numbers: { where: { isPrimary: true, retiredAt: null },
        select: { providerNumberId: true }, take: 1 },
    },
  });
  if (!account || account.provider.toLowerCase() !== "twilio") throw new Error("TELECOM_UNCONFIGURED");
  if (!input.adapter && account.environment !== "PRODUCTION") throw new Error("TELECOM_UNCONFIGURED");
  const adapter = input.adapter ?? makeTwilioReadAdapter(account.externalAccountId);
  if (!adapter) throw new Error("TELECOM_UNCONFIGURED");
  await prisma.telecomSyncCursor.createMany({
    data: [{ accountId, resource, windowStart, windowEnd }], skipDuplicates: true,
  });
  const key = { accountId_resource: { accountId, resource } };
  const cursor = await prisma.telecomSyncCursor.findUniqueOrThrow({ where: key });
  if (cursor.nextPageToken && (+cursor.windowStart !== +windowStart || +cursor.windowEnd !== +windowEnd)) {
    throw new Error("SYNC_WINDOW_INCOMPLETE");
  }
  const token = randomUUID(), claimUntil = new Date(+now + 90_000);
  const claimed = await prisma.telecomSyncCursor.updateMany({
    where: {
      id: cursor.id, windowStart: cursor.windowStart, windowEnd: cursor.windowEnd,
      OR: [{ claimUntil: null }, { claimUntil: { lt: now } }],
    },
    data: { claimToken: token, claimUntil,
      ...(+cursor.windowStart !== +windowStart || +cursor.windowEnd !== +windowEnd
        ? { windowStart, windowEnd, nextPageToken: null, completedThrough: null } : {}),
    },
  });
  if (claimed.count !== 1) throw new Error("SYNC_BUSY");
  let next = +cursor.windowStart === +windowStart && +cursor.windowEnd === +windowEnd
    ? cursor.nextPageToken : null;
  let pages = 0, records = 0, unknownPrices = 0, completed = false;
  try {
    while (pages < maxPages) {
      const page = await adapter.read({
        resource, start: windowStart, end: windowEnd, next,
        primaryNumberId: account.numbers[0]?.providerNumberId ?? null,
      });
      if (page.kind !== resource || (page.next && page.next === next)) {
        throw new Error("INVALID_PROVIDER_CURSOR");
      }
      const finish = page.next === null, release = finish || pages + 1 === maxPages;
      const unknown = await prisma.$transaction(async tx => {
        const current = await tx.telecomSyncCursor.findUniqueOrThrow({ where: key });
        if (current.claimToken !== token || !current.claimUntil ||
            current.claimUntil < now || +current.windowStart !== +windowStart ||
            +current.windowEnd !== +windowEnd) throw new Error("STALE_TELECOM_CLAIM");
        const missing = await persistObservedPage(tx, accountId, page, now);
        await tx.telecomSyncCursor.update({ where: key, data: {
          nextPageToken: page.next, completedThrough: finish ? windowEnd : null,
          lastSuccessAt: now, lastFailureAt: null, lastErrorCode: null,
          ...(release ? { claimToken: null, claimUntil: null } : {}),
        } });
        return missing;
      });
      pages++; records += page.items.length; unknownPrices += unknown;
      next = page.next; completed = finish;
      if (release) break;
    }
    return { pages, records, unknownPrices, completed, nextPageToken: next };
  } catch (error) {
    await prisma.telecomSyncCursor.updateMany({
      where: { id: cursor.id, claimToken: token }, data: {
        claimToken: null, claimUntil: null, lastFailureAt: now, lastErrorCode: errorCode(error),
      },
    });
    throw error;
  }
}
