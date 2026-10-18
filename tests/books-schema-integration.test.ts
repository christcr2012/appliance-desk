import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { BACKUP_TABLES } from "@/domains/backup/manifest";
import { SYSTEM_ACCOUNTS, DEFAULT_EXPENSE_CATEGORIES, accountIdForRole, ensureTaxLiabilityAccounts } from "@/domains/books/accounts";

describe("K-1A additive books schema on disposable PostgreSQL", () => {
  it("seeds all immutable system roles and category links without mutating existing financial source rows", async () => {
    const roles = await prisma.ledgerAccount.findMany({ where: { systemRole: { in: SYSTEM_ACCOUNTS.map(x => x.role) } } });
    expect(roles).toHaveLength(SYSTEM_ACCOUNTS.length);
    for (const role of SYSTEM_ACCOUNTS) {
      expect(roles.find(x => x.systemRole === role.role)).toMatchObject({
        type:role.type, isPaymentSource:role.paymentSource, active:true,
      });
    }
    const categories = await prisma.expenseCategory.findMany({ where: { name: { in: DEFAULT_EXPENSE_CATEGORIES.map(x => x.name) } } });
    expect(categories).toHaveLength(DEFAULT_EXPENSE_CATEGORIES.length);
    expect(categories.every(row => roles.some(account => account.id === row.ledgerAccountId))).toBe(true);
    expect(BACKUP_TABLES).toEqual(expect.arrayContaining([
      "ledgerAccount","accountExportMapping","journalEntry","journalLine","accountingPeriod",
      "stripeBalanceTransaction","integrationCursor","expenseCategory","expense",
      "recurringExpense","exportBatch","exportBatchEntry",
    ]));
  });
  it("creates per-filing-account liabilities once and never overwrites owner edits", async () => {
    const id = "k1-filing-"+randomUUID();
    await prisma.taxFilingAccount.create({data:{id,name:"Synthetic filing"}});
    try {
      await prisma.$transaction(async tx => { await ensureTaxLiabilityAccounts(tx); await ensureTaxLiabilityAccounts(tx); });
      const sales = await prisma.ledgerAccount.findUnique({where:{systemRole:"SALES_TAX:"+id}});
      const use = await prisma.ledgerAccount.findUnique({where:{systemRole:"USE_TAX:"+id}});
      expect(sales?.type).toBe("LIABILITY");
      expect(use?.type).toBe("LIABILITY");
      await prisma.ledgerAccount.update({where:{id:sales!.id},data:{name:"Owner renamed tax ledger"}});
      await prisma.$transaction(ensureTaxLiabilityAccounts);
      expect((await prisma.ledgerAccount.findUnique({where:{systemRole:"SALES_TAX:"+id}}))?.name).toBe("Owner renamed tax ledger");
    } finally {
      await prisma.ledgerAccount.deleteMany({where:{systemRole:{in:["SALES_TAX:"+id,"USE_TAX:"+id]}}});
      await prisma.taxFilingAccount.delete({where:{id}});
    }
  });
  it("refuses missing/inactive roles and concurrent duplicate source posting", async () => {
    const id = "k1-"+randomUUID();
    const bank = await prisma.$transaction(tx => accountIdForRole(tx,"BANK"));
    await expect(prisma.$transaction(tx => accountIdForRole(tx,"NONEXISTENT_SYSTEM_ROLE"))).rejects.toThrow(/Missing or inactive/);
    const entry = { entryDate:new Date("2026-10-17T06:00:00Z"), periodKey:"2026-10", sourceType:"OPENING" as const,
      sourceId:id, eventKind:"OPENING_BALANCE", memo:"Synthetic accounting idempotency proof",
      lines:{create:[{ledgerAccountId:bank,debitCents:100,creditCents:0},
        {ledgerAccountId:(await prisma.ledgerAccount.findUniqueOrThrow({where:{systemRole:"OWNER_CONTRIBUTIONS"}})).id,debitCents:0,creditCents:100}]},
    };
    try {
      const results = await Promise.allSettled(Array.from({length:8},()=>prisma.journalEntry.create({data:entry})));
      expect(results.filter(x=>x.status==="fulfilled")).toHaveLength(1);
      expect(await prisma.journalEntry.count({where:{sourceType:"OPENING",sourceId:id,eventKind:"OPENING_BALANCE"}})).toBe(1);
      const saved = await prisma.journalEntry.findFirstOrThrow({where:{sourceId:id}});
      await expect(prisma.journalLine.create({data:{entryId:saved.id,ledgerAccountId:bank,debitCents:1,creditCents:1}})).rejects.toThrow();
      await expect(prisma.journalLine.create({data:{entryId:saved.id,ledgerAccountId:bank,debitCents:-1,creditCents:0}})).rejects.toThrow();
    } finally {
      await prisma.journalLine.deleteMany({where:{entry:{sourceId:id}}});
      await prisma.journalEntry.deleteMany({where:{sourceId:id}});
    }
  });
});
