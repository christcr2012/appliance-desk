import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,describe,expect,it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey,businessDateKey } from "@/lib/business-date";
import { getBudgetContext } from "@/domains/budget/context";
import { createExpense,getExpenses,saveRecurringExpense } from "@/domains/books/expenses";
import { saveBudgetCostPlan,saveBudgetTarget,settleBudgetCost,
 reverseBudgetCostSettlement,getBudgetPlanning } from "@/domains/budget/planning";

const db=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&["localhost","127.0.0.1"].includes(db.hostname)
 &&db.pathname==="/appliance_desk_test";
const stamp=randomUUID().slice(0,10);
const owner="bp-owner-"+stamp,staff="bp-staff-"+stamp,env="bp-env-"+stamp;
const expenseId="bp-exp-"+stamp,category="bp-cat-"+stamp,ledger="bp-ledger-"+stamp;
const d=businessDateKey(new Date()),on=businessDateFromKey(d)!;
let oldRevision=BigInt(0),oldHorizon=90,bankLedger="",sourceJournal="";
const planIds:string[]=[],settlementIds:string[]=[];
const sourceTemplate="bp-recurring-"+stamp;
const reason="Reviewed disposable budget plan and posting evidence";
describe.skipIf(!enabled)("K-CASH-5A cost schedules, source settlements and tenant guards",()=>{
 beforeAll(async()=>{
  oldRevision=(await prisma.budgetState.findUniqueOrThrow({where:{id:"singleton"}})).revision;
  oldHorizon=(await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"}})).budgetPlanningHorizonDays;
  await prisma.user.createMany({data:[
   {id:owner,email:owner+"@example.test",role:"OWNER"},
   {id:staff,email:staff+"@example.test",role:"STAFF"}]});
  await prisma.budgetEnvelope.create({data:{id:env,name:"Disposable invoice fund"}});
  bankLedger=(await prisma.ledgerAccount.findFirstOrThrow({where:{systemRole:"BANK"}})).id;
  await prisma.ledgerAccount.create({data:{id:ledger,name:"Disposable budget bill",type:"EXPENSE",description:"Synthetic budget test account"}});
  await prisma.expenseCategory.create({data:{id:category,name:"Disposable budget expense",description:"Synthetic test cost category",ledgerAccountId:ledger}});
  await prisma.expense.create({data:{
   id:expenseId,status:"POSTED",spentOn:on,amountCents:5000,
   vendorTaxCents:0,vendorName:"Synthetic",categoryId:category,
   paidFromAccountId:bankLedger,submittedByUserId:owner,postedByUserId:owner}});
  sourceJournal=(await prisma.journalEntry.create({data:{
   sourceType:"EXPENSE",sourceId:expenseId,eventKind:"EXPENSE_POSTED",
   entryDate:on,periodKey:d.slice(0,7),memo:"Disposable budget paid source",
   lines:{create:[{ledgerAccountId:ledger,debitCents:5000},
    {ledgerAccountId:bankLedger,creditCents:5000}]}}})).id;
 });
 afterAll(async()=>{
  await prisma.$transaction(async tx=>{
   await tx.$executeRawUnsafe("SELECT set_config('app.synthetic_budget_cleanup','yes',true)");
   await tx.budgetCostSettlement.deleteMany({where:{
    occurrence:{planId:{in:planIds}},reversalOfId:{not:null}}});
   await tx.budgetCostSettlement.deleteMany({where:{occurrence:{planId:{in:planIds}}}});
  });
  await prisma.budgetCostOccurrence.deleteMany({where:{planId:{in:planIds}}});
  await prisma.budgetCostPlan.deleteMany({where:{id:{in:planIds}}});
  await prisma.recurringExpense.deleteMany({where:{id:sourceTemplate}});
  await prisma.budgetTarget.deleteMany({where:{envelopeId:env}});
  await prisma.budgetEnvelope.deleteMany({where:{id:env}});
  await prisma.journalLine.deleteMany({where:{entryId:sourceJournal}});
  await prisma.journalEntry.deleteMany({where:{id:sourceJournal}});
  await prisma.expense.deleteMany({where:{OR:[{id:expenseId},{vendorName:"Budget intent "+stamp}]}});
  await prisma.expenseCategory.deleteMany({where:{id:category}});
  await prisma.ledgerAccount.deleteMany({where:{id:ledger}});
  await prisma.auditLog.deleteMany({where:{userId:{in:[owner,staff]}}});
  await prisma.user.deleteMany({where:{id:{in:[owner,staff]}}});
  await prisma.budgetState.update({where:{id:"singleton"},data:{revision:oldRevision}});
  await prisma.businessSettings.update({where:{id:"singleton"},data:{budgetPlanningHorizonDays:oldHorizon}});
 });
 it("returns a labels-only DTO to staff and refuses archived actors' private finance data",async()=>{
  const labels=await getBudgetContext(staff);
  expect(labels.role).toBe("STAFF");
  expect(labels.envelopes.every(x=>Object.keys(x).length===2)).toBe(true);
  expect(JSON.stringify(labels)).not.toMatch(/readyCents|protectedCents|balanceCents/);
  const ownerView=await getBudgetContext(owner);
  expect(ownerView.role).toBe("MANAGER");
 });
 it("records STAFF's selected expense label as audit evidence, never a financial move or private balance",async()=>{
  const made=await createExpense(staff,{date:d,amountCents:1234,vendorTaxCents:0,
   vendorName:"Budget intent "+stamp,categoryId:category,paidFromAccountId:bankLedger,
   budgetEnvelopeId:env},"SUBMITTED");
  const returned=await getExpenses(staff);
  const own=returned.rows.find(row=>row.id===made.id);
  expect(own?.budgetIntentLabel).toBe("Disposable invoice fund");
  expect(own?.status).toBe("SUBMITTED");
  expect(await prisma.budgetMove.count({where:{envelopeId:env}})).toBe(0);
  expect(await prisma.auditLog.count({where:{entityType:"Expense",entityId:made.id,
   action:"books.expense.budget-intent"}})).toBe(1);
 });
 it("creates only actual bounded future cost occurrences and refuses staff mutations",async()=>{
  await expect(saveBudgetCostPlan(staff,{envelopeId:env,name:"Denied bill",
   amountCents:5000,amountQuality:"EXACT",dueOn:d,recurrence:"MONTHLY",
   reason})).rejects.toThrow(/access/);
  const id=await saveBudgetCostPlan(owner,{envelopeId:env,name:"Evidence-backed monthly bill",
   amountCents:5000,amountQuality:"EXACT",dueOn:d,recurrence:"MONTHLY",reason});
  planIds.push(id);
  const saved=await prisma.budgetCostPlan.findUniqueOrThrow({where:{id},
   include:{occurrences:true}});
  expect(saved.occurrences.length).toBeGreaterThan(0);
  expect(saved.occurrences.every(x=>x.amountCents===5000&&x.status==="PLANNED")).toBe(true);
  await expect(saveBudgetCostPlan(owner,{planId:id,expectedVersion:13,envelopeId:env,
   name:"Changed bill",amountCents:6000,amountQuality:"ESTIMATE",dueOn:d,
   recurrence:"MONTHLY",reason})).rejects.toThrow(/changed/);
  await expect(getBudgetPlanning(staff,d)).rejects.toThrow(/access/);
 });
 it("keeps a linked recurring plan in step with the existing Books source edit",async()=>{
  const anchor=d.slice(0,8)+"28";
  await prisma.recurringExpense.create({data:{id:sourceTemplate,name:"Current source",
   vendorName:"Source vendor",amountCents:4200,dayOfMonth:28,
   categoryId:category,paidFromAccountId:bankLedger}});
  const linked=await saveBudgetCostPlan(owner,{envelopeId:env,name:"Current source",
   amountCents:4200,amountQuality:"ESTIMATE",dueOn:anchor,recurrence:"MONTHLY",
   sourceType:"RECURRING_EXPENSE",sourceId:sourceTemplate,reason});
  planIds.push(linked);
  await saveRecurringExpense(owner,{name:"Changed verified source",vendorName:"Source vendor",
    amountCents:5200,dayOfMonth:28,categoryId:category,paidFromAccountId:bankLedger,
    active:true},sourceTemplate);
  const after=await prisma.budgetCostPlan.findUniqueOrThrow({where:{id:linked},
   include:{occurrences:{where:{status:"PLANNED"}}}});
  expect(after.name).toBe("Changed verified source");
  expect(after.amountCents).toBe(5200);
  expect(after.occurrences.every(x=>x.amountCents===5200)).toBe(true);
 });
 it("records target only once per envelope with optimistic corrections and no cash entries",async()=>{
  await expect(saveBudgetTarget(staff,{envelopeId:env,kind:"SAVE_BY_DATE",
   amountCents:120000,dueOn:d,reason})).rejects.toThrow(/access/);
  const id=await saveBudgetTarget(owner,{envelopeId:env,kind:"SAVE_BY_DATE",
   amountCents:120000,dueOn:d,reason});
  const target=await prisma.budgetTarget.findUniqueOrThrow({where:{id}});
  expect(target.amountCents).toBe(120000);
  await expect(saveBudgetTarget(owner,{envelopeId:env,expectedVersion:4,
   kind:"MAINTAIN_BALANCE",amountCents:10000,reason})).rejects.toThrow(/changed/);
  await saveBudgetTarget(owner,{envelopeId:env,expectedVersion:target.version,
   kind:"MAINTAIN_BALANCE",amountCents:10000,reason});
  expect(await prisma.budgetTarget.count({where:{envelopeId:env}})).toBe(1);
  expect(await prisma.budgetMove.count({where:{envelopeId:env}})).toBe(0);
 });
 it("settles only a truly posted source and handles identical replay, changed replay and exact one-time correction",async()=>{
  const plan=await prisma.budgetCostPlan.findFirstOrThrow({where:{id:{in:planIds}},
   include:{occurrences:{orderBy:{dueOn:"asc"},take:1}}});
  const occurrence=plan.occurrences[0]!;
  const state=await prisma.budgetState.findUniqueOrThrow({where:{id:"singleton"}});
  const key="bp-paid-"+stamp;
  const args={occurrenceId:occurrence.id,expenseId,amountCents:2000,
   expectedRevision:state.revision.toString(),commandKey:key,reason};
  const saved=await settleBudgetCost(owner,args);
  settlementIds.push(saved);
  expect(await settleBudgetCost(owner,args)).toBe(saved);
  await expect(settleBudgetCost(owner,{...args,amountCents:2500})).rejects.toThrow(/key/);
  expect((await prisma.budgetCostOccurrence.findUniqueOrThrow({where:{id:occurrence.id}})).status).toBe("PART_PAID");
  const state2=await prisma.budgetState.findUniqueOrThrow({where:{id:"singleton"}});
  const inverse=await reverseBudgetCostSettlement(owner,{settlementId:saved,
   expectedRevision:state2.revision.toString(),reason,commandKey:"bp-reverse-"+stamp});
  settlementIds.push(inverse);
  expect((await prisma.budgetCostOccurrence.findUniqueOrThrow({where:{id:occurrence.id}})).status).toBe("PLANNED");
  expect(await reverseBudgetCostSettlement(owner,{settlementId:saved,
   expectedRevision:state2.revision.toString(),reason,commandKey:"bp-reverse-"+stamp})).toBe(inverse);
  await expect(reverseBudgetCostSettlement(owner,{settlementId:saved,
   expectedRevision:state2.revision.toString(),reason,commandKey:"bp-again-"+stamp}))
   .rejects.toThrow(/already/);
  expect(await prisma.budgetCostSettlement.count({where:{occurrenceId:occurrence.id}})).toBe(2);
 });
 it("keeps plans readable as unspent obligations when source readiness is unknown",async()=>{
  const result=await getBudgetPlanning(owner,d);
  expect(result.envelopes.some(x=>x.id===env&&x.needCents>0)).toBe(true);
  expect(result.upcoming.some(x=>x.planId===planIds[0]&&x.unpaidCents>0)).toBe(true);
  expect(result.proposal.legs).toHaveLength(0);
 });
});
