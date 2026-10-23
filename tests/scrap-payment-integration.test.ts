import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { listDepositAccounts, recordScrapPayment, voidScrapPayment } from "@/domains/inventory/retired-plans";
import { businessDateKey } from "@/lib/business-date";

// Batch M-2: a scrap-yard check is entered in a lump and posts to "Scrap sales" income once; a void reverses it.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("scrap money on real Postgres", () => {
  const tag = randomUUID().slice(0, 8);
  let ownerId: string;
  let savedStart: Date | null = null;
  const ids: string[] = [];

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    savedStart = (await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { booksStartDate: true } })).booksStartDate;
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { booksStartDate: new Date("2026-01-01T07:00:00Z") } });
  });

  afterAll(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { booksStartDate: savedStart } });
    await prisma.journalLine.deleteMany({ where: { entry: { sourceType: "SCRAP_PAYMENT", sourceId: { in: ids } } } });
    await prisma.journalEntry.deleteMany({ where: { sourceType: "SCRAP_PAYMENT", sourceId: { in: ids } } });
    await prisma.scrapPayment.deleteMany({ where: { id: { in: ids } } });
  });

  const net = async (id: string, role: string) =>
    (await prisma.journalLine.findMany({ where: { entry: { sourceType: "SCRAP_PAYMENT", sourceId: id }, ledgerAccount: { systemRole: role } } }))
      .reduce((n, l) => n + l.debitCents - l.creditCents, 0);

  it("posts bank in / scrap income out once, replays safely, and a void reverses it exactly", async () => {
    const bank = (await listDepositAccounts(ownerId)).find((a) => a.name.toLowerCase().includes("checking")) ?? (await listDepositAccounts(ownerId))[0]!;
    const input = { operationKey: `scrap-${tag}-1`, receivedOnKey: businessDateKey(new Date()), amountCents: 18_750, yardName: `Yard ${tag}`, note: "Ticket 4411", depositAccountId: bank.id };
    const first = await recordScrapPayment(ownerId, input);
    ids.push(first.id);
    expect(first.replayed).toBe(false);
    const again = await recordScrapPayment(ownerId, input);
    expect(again).toEqual({ id: first.id, replayed: true });
    await expect(recordScrapPayment(ownerId, { ...input, amountCents: 100 })).rejects.toThrow(/already used/);

    expect(await prisma.journalEntry.count({ where: { sourceType: "SCRAP_PAYMENT", sourceId: first.id, eventKind: "SCRAP_RECEIVED" } })).toBe(1);
    expect(await net(first.id, "SCRAP_INCOME")).toBe(-18_750);
    const bankRole = (await prisma.ledgerAccount.findUniqueOrThrow({ where: { id: bank.id } })).systemRole ?? "";
    if (bankRole) expect(await net(first.id, bankRole)).toBe(18_750);

    await expect(voidScrapPayment(ownerId, first.id, " ")).rejects.toThrow(/why/);
    await voidScrapPayment(ownerId, first.id, "Entered twice");
    await voidScrapPayment(ownerId, first.id, "Entered twice"); // repeat changes nothing
    expect(await net(first.id, "SCRAP_INCOME")).toBe(0);
    expect(await prisma.journalEntry.count({ where: { sourceType: "SCRAP_PAYMENT", sourceId: first.id } })).toBe(2);
  });

  it("refuses a deposit account that is not a bank or cash account, a bad amount, and a future date", async () => {
    const income = await prisma.ledgerAccount.findFirstOrThrow({ where: { systemRole: "SCRAP_INCOME" } });
    const bank = (await listDepositAccounts(ownerId))[0]!;
    const base = { receivedOnKey: businessDateKey(new Date()), amountCents: 500, yardName: "Yard", depositAccountId: income.id };
    await expect(recordScrapPayment(ownerId, { ...base, operationKey: `scrap-${tag}-2` })).rejects.toThrow(/bank or cash/);
    await expect(recordScrapPayment(ownerId, { ...base, operationKey: `scrap-${tag}-3`, depositAccountId: bank.id, amountCents: 0 })).rejects.toThrow(/greater than/);
    await expect(recordScrapPayment(ownerId, { ...base, operationKey: `scrap-${tag}-4`, depositAccountId: bank.id, receivedOnKey: "2999-01-01" })).rejects.toThrow(/future/);
  });
});
