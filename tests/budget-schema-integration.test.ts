import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { deriveRestoreTableOrder } from "../scripts/lib/table-order";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { BACKUP_MODEL_POLICY,BACKUP_TABLES } from "@/domains/backup/manifest";
import { buildDatabaseBackupSnapshot } from "@/domains/backup";
const id=randomUUID().slice(0,10);
const db=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&["localhost","127.0.0.1"].includes(db.hostname)&&db.pathname==="/appliance_desk_test";
const names=["budgetState","budgetEnvelope","budgetMove","budgetSpendSplit",
 "budgetTarget","budgetCostPlan","budgetCostOccurrence","budgetCostSettlement"];
describe.skipIf(!enabled)("K-CASH-4A additive populated Postgres budget schema and restore source",()=>{
 it("preserves one empty state and seven editable funded-by-nobody envelope labels",async()=>{
  expect(await prisma.budgetState.count()).toBe(1);
  expect((await prisma.budgetState.findUniqueOrThrow({where:{id:"singleton"}})).revision).toBe(BigInt(1));
  const labels=await prisma.budgetEnvelope.findMany({where:{id:{startsWith:"budget-default-"}},
   orderBy:{sortOrder:"asc"}});
  expect(labels.map(l=>l.name)).toEqual(["Operating costs","Repairs and parts",
    "Appliance purchases/replacement","Annual fees and insurance","Income-tax planning",
    "Owner pay","Emergency cushion"]);
  expect(await prisma.budgetMove.count()).toBe(0);
  const settings=await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"}});
  expect(settings.cashBudgetEnabled).toBe(false);
  expect(settings.cashBudgetStartOn).toBeNull();
  expect(settings.bankEvidenceMaxAgeDays).toBe(7);
  expect(settings.budgetPlanningHorizonDays).toBe(90);
  expect(settings.budgetUpcomingWindowDays).toBe(30);
  expect(settings.budgetReminderLeadDays).toBe(7);
 });
 it("protects every named budget source model with backup and schema-visible delegates",async()=>{
  for(const model of names){
   expect(BACKUP_TABLES).toContain(model);
   expect(typeof (prisma as unknown as Record<string,unknown>)[model]).toBe("object");
  }
  const snapshot=await buildDatabaseBackupSnapshot();
  for(const model of names)expect(snapshot.payload.tables[model]).toBeInstanceOf(Array);
  expect(snapshot.payload.tables.budgetEnvelope).toHaveLength(7);
  expect(snapshot.tableCounts.budgetState).toBe(1);
 });
 it("derives a safe populated restore order with self-reversal links deferred",()=>{
  const schema=readFileSync("prisma/schema.prisma","utf8");
  const sorted=deriveRestoreTableOrder(schema,BACKUP_MODEL_POLICY);
  for(const model of names)expect(sorted).toContain(model);
  expect(sorted.indexOf("budgetEnvelope")).toBeLessThan(sorted.indexOf("budgetMove"));
  expect(sorted.indexOf("journalLine")).toBeLessThan(sorted.indexOf("budgetSpendSplit"));
  expect(sorted.indexOf("budgetCostPlan")).toBeLessThan(sorted.indexOf("budgetCostOccurrence"));
  expect(sorted.indexOf("budgetCostOccurrence")).toBeLessThan(sorted.indexOf("budgetCostSettlement"));
 });
 it("persists typed FK-linked goals, recurrence, settlements, and reversal lineage",async()=>{
  const envelopeId="test-budget-"+id,planId="test-budget-plan-"+id;
  await prisma.budgetEnvelope.create({data:{id:envelopeId,name:"Fixture repairs",groupLabel:"Private fixture"}});
  try {
   const target=await prisma.budgetTarget.create({data:{
    envelopeId,kind:"SAVE_BY_DATE",amountCents:100000,
    dueOn:new Date("2026-12-01T07:00:00.000Z"),repeat:"NONE"}});
   const plan=await prisma.budgetCostPlan.create({data:{id:planId,envelopeId,
    name:"Synthetic recurring liability",amountCents:9000,amountQuality:"ESTIMATE",
    dueOn:new Date("2026-11-15T07:00:00.000Z"),recurrence:"MONTHLY",anchorDay:15,
    sourceType:"MANUAL"}});
   const occ=await prisma.budgetCostOccurrence.create({data:{
    planId:plan.id,dueOn:plan.dueOn,amountCents:9000}});
   const settled=await prisma.budgetCostSettlement.create({data:{occurrenceId:occ.id,
    sourceType:"EXPENSE",sourceId:"synthetic-expense-"+id,amountCents:1200,
    commandKey:"budget-settle-"+id,payloadHash:"1".repeat(64)}});
   const reverse=await prisma.budgetCostSettlement.create({data:{occurrenceId:occ.id,
    sourceType:"EXPENSE",sourceId:"synthetic-expense-"+id,amountCents:1200,
    commandKey:"budget-undo-"+id,payloadHash:"2".repeat(64),reversalOfId:settled.id}});
   expect(reverse.reversalOfId).toBe(settled.id);
   await expect(prisma.budgetCostSettlement.create({data:{occurrenceId:occ.id,
    sourceType:"EXPENSE",sourceId:"synthetic-expense-"+id,amountCents:1200,
    commandKey:"budget-duplicate-"+id,payloadHash:"3".repeat(64)}})).rejects.toThrow();
   await expect(prisma.budgetCostOccurrence.create({data:{
    planId:plan.id,dueOn:plan.dueOn,amountCents:1}})).rejects.toThrow();
   await expect(prisma.budgetTarget.create({data:{envelopeId,
    kind:"SAVE_BY_DATE",amountCents:100}})).rejects.toThrow();
   expect(target.amountCents).toBe(100000);
   expect(await prisma.budgetCostSettlement.count({where:{occurrenceId:occ.id}})).toBe(2);
  }finally{
   await prisma.$transaction(async tx=>{
    await tx.$executeRawUnsafe("SELECT set_config('app.synthetic_budget_cleanup','yes',true)");
    await tx.budgetCostSettlement.deleteMany({where:{occurrence:{planId}}});
   });
   await prisma.budgetCostOccurrence.deleteMany({where:{planId}});
   await prisma.budgetCostPlan.deleteMany({where:{id:planId}});
   await prisma.budgetTarget.deleteMany({where:{envelopeId}});
   await prisma.budgetEnvelope.deleteMany({where:{id:envelopeId}});
  }
 });
 it("enforces signed move kinds, original/reversal uniqueness and foreign account barriers",async()=>{
  const envelopeId="test-budget-move-"+id;
  await prisma.budgetEnvelope.create({data:{id:envelopeId,name:"Synthetic balance test"}});
  const base={envelopeId,reason:"Synthetic, no real budget dollars",
   payloadHash:"9".repeat(64)};
  try{
   await expect(prisma.budgetMove.create({data:{...base,
    commandKey:"zero-"+id,signedCents:0,kind:"ASSIGN"}})).rejects.toThrow();
   await expect(prisma.budgetMove.create({data:{...base,
    commandKey:"wrong-sign-"+id,signedCents:200,kind:"RELEASE"}})).rejects.toThrow();
   const original=await prisma.budgetMove.create({data:{...base,
    commandKey:"original-"+id,signedCents:375,kind:"ASSIGN"}});
   const release=await prisma.budgetMove.create({data:{...base,
    commandKey:"release-"+id,signedCents:-100,kind:"RELEASE"}});
   await expect(prisma.budgetMove.create({data:{...base,
    commandKey:original.commandKey,signedCents:800,kind:"ASSIGN"}})).rejects.toThrow();
   const undo=await prisma.budgetMove.create({data:{...base,
    commandKey:"undo-"+id,signedCents:100,kind:"REVERSAL",
    sourceType:"BUDGET",sourceId:release.id,eventKind:"RELEASE_UNDO",
    reversalOfId:release.id}});
   expect(undo.reversalOfId).toBe(release.id);
   await expect(prisma.budgetMove.create({data:{...base,
    commandKey:"foreign-"+id,envelopeId:"missing-budget-envelope",
    signedCents:1,kind:"ASSIGN"}})).rejects.toThrow();
  }finally{
   await prisma.$transaction(async tx=>{
    await tx.$executeRawUnsafe("SELECT set_config('app.synthetic_budget_cleanup','yes',true)");
    await tx.budgetMove.deleteMany({where:{envelopeId}});
   });
   await prisma.budgetEnvelope.delete({where:{id:envelopeId}});
  }
 });
});