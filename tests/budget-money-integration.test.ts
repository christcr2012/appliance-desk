import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,describe,expect,it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey,businessDateKey } from "@/lib/business-date";
import { confirmBankMatch } from "@/domains/books/cash/matches";
import { createBankReconciliation,completeBankReconciliation } from "@/domains/books/cash/reconcile";
import { getBudgetSnapshot,attestBudgetSources,setBudgetActivation } from "@/domains/budget/protected";
import { applyBudgetMoves,undoBudgetMove } from "@/domains/budget/moves";
import { assignPostedBankSpending,reversePostedBankSpending } from "@/domains/budget/spending";

const url=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&["localhost","127.0.0.1"].includes(url.hostname)&&url.pathname==="/appliance_desk_test";
const tag=randomUUID().slice(0,10),owner="budget-owner-"+tag,admin="budget-admin-"+tag,staff="budget-staff-"+tag;
const bankLedger="budget-ledger-"+tag,cmd="budget-cmd-"+tag;
const date=businessDateKey(new Date()),day=businessDateFromKey(date)!;
let oldSettings:{cashBudgetEnabled:boolean;cashBudgetStartOn:Date|null;booksStartDate:Date|null}|null=null;
let oldState:{revision:bigint;startOn:Date|null;readinessAttestation:unknown}|null=null;
let bank="",bankImport="",bankObs="",entryId="",statement="",group="";
let account="",bookRev=BigInt(0);
const lineIds:string[]=[],additionalEntries:string[]=[];
const ownerId=(suffix:string)=>cmd+"-"+suffix;
describe.skipIf(!enabled)("K-CASH-4B serial disposable Postgres cash authority and funding",()=>{
 beforeAll(async()=>{
  const settings=await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"}});
  oldSettings={cashBudgetEnabled:settings.cashBudgetEnabled,cashBudgetStartOn:settings.cashBudgetStartOn,booksStartDate:settings.booksStartDate};
  const state=await prisma.budgetState.findUniqueOrThrow({where:{id:"singleton"}});
  oldState={revision:state.revision,startOn:state.startOn,readinessAttestation:state.readinessAttestation};
  bookRev=(await prisma.booksPostingRevision.findUniqueOrThrow({where:{id:"singleton"}})).revision;
  await prisma.businessSettings.update({where:{id:"singleton"},data:{
   cashBudgetEnabled:false,cashBudgetStartOn:null,booksStartDate:day}});
  await prisma.user.createMany({data:[
   {id:owner,email:owner+"@example.test",role:"OWNER"},
   {id:admin,email:admin+"@example.test",role:"ADMIN"},
   {id:staff,email:staff+"@example.test",role:"STAFF"}]});
  const equity=await prisma.ledgerAccount.findUniqueOrThrow({where:{systemRole:"OWNER_CONTRIBUTIONS"}});
  await prisma.ledgerAccount.create({data:{id:bankLedger,name:"Synthetic budget bank",type:"ASSET",
   description:"Budget Postgres fixture only",isPaymentSource:true}});
  bank=(await prisma.cashAccount.create({data:{ledgerAccountId:bankLedger,
   name:"Synthetic budget checking",institutionLabel:"Test Bank"}})).id;
  const entry=await prisma.journalEntry.create({data:{
   sourceType:"OPENING",sourceId:ownerId("opening"),eventKind:"OPENING_BALANCE",
   entryDate:day,periodKey:date.slice(0,7),memo:"Synthetic budget bank opening",
   lines:{create:[{ledgerAccountId:bankLedger,debitCents:20000},
     {ledgerAccountId:equity.id,creditCents:20000}]}},include:{lines:true}});
  entryId=entry.id;lineIds.push(entry.lines.find(x=>x.ledgerAccountId===bankLedger)!.id);
  bankImport=(await prisma.bankImport.create({data:{
   cashAccountId:bank,sha256:"5".repeat(64),mappingHash:"6".repeat(64),
   mapping:{schemaVersion:1},rowCount:1,importedByUserId:owner}})).id;
  bankObs=(await prisma.bankObservation.create({data:{
   cashAccountId:bank,importId:bankImport,rowNumber:1,postedOn:day,
   signedCents:20000,description:"Synthetic verified owner contribution",
   fingerprint:"7".repeat(64),occurrenceIndex:1}})).id;
  group=await confirmBankMatch(owner,{accountId:bank,commandKey:ownerId("match"),
   observationIds:[bankObs],journalLineIds:lineIds});
  statement=await createBankReconciliation(owner,{accountId:bank,fromDate:date,toDate:date,
   beginningCents:0,endingCents:20000,
   statementSourceReference:"Synthetic bank through-date reviewed",
   confirmedThroughDate:true,
   firstStatement:{bookBeginningCents:0,preStartOutstandingCents:0,
    sourceReference:"Synthetic opening book and bank evidence"}});
  await completeBankReconciliation(owner,statement,1);
  account=(await prisma.budgetEnvelope.findFirstOrThrow({where:{id:"budget-default-repairs"}})).id;
 });
 afterAll(async()=>{
  await prisma.budgetMove.deleteMany({where:{actorId:owner,reversalOfId:{not:null}}});
  await prisma.budgetMove.deleteMany({where:{OR:[{actorId:owner},{commandKey:{startsWith:cmd}}]}});
  await prisma.budgetSpendSplit.deleteMany({where:{journalLineId:{in:lineIds}}});
  await prisma.budgetState.update({where:{id:"singleton"},data:{
   revision:oldState?.revision??BigInt(1),startOn:oldState?.startOn??null,
   readinessAttestation:oldState?.readinessAttestation==null?
    Prisma.DbNull:oldState.readinessAttestation as Prisma.InputJsonValue}});
  await prisma.businessSettings.update({where:{id:"singleton"},data:{
   cashBudgetEnabled:oldSettings?.cashBudgetEnabled??false,
   cashBudgetStartOn:oldSettings?.cashBudgetStartOn??null,
   booksStartDate:oldSettings?.booksStartDate??null}});
  await prisma.bankMatchItem.deleteMany({where:{groupId:group}});
  await prisma.bankMatchGroup.deleteMany({where:{id:group}});
  await prisma.bankReconciliation.deleteMany({where:{id:statement}});
  await prisma.bankObservation.deleteMany({where:{id:bankObs}});
  await prisma.bankImport.deleteMany({where:{id:bankImport}});
  await prisma.journalLine.deleteMany({where:{entryId:{in:[entryId,...additionalEntries]}}});
  await prisma.journalEntry.deleteMany({where:{id:{in:[entryId,...additionalEntries]}}});
  await prisma.cashAccount.deleteMany({where:{id:bank}});
  await prisma.ledgerAccount.deleteMany({where:{id:bankLedger}});
  await prisma.auditLog.deleteMany({where:{userId:{in:[owner,admin,staff]}}});
  await prisma.user.deleteMany({where:{id:{in:[owner,admin,staff]}}});
  await prisma.booksPostingRevision.update({where:{id:"singleton"},data:{revision:bookRev}});
 });
 it("is OFF and rejects staff disclosure or administrator allocation",async()=>{
  const snap=await getBudgetSnapshot(owner,date);
  expect(snap.enabled).toBe(false);
  expect(snap.mayAssign).toBe(false);
  expect(snap.status).not.toBe("READY");
  expect(snap.eligibleBankCents).toBe(20000);
  await expect(getBudgetSnapshot(staff,date)).rejects.toThrow(/access/);
  await expect(applyBudgetMoves(admin,{asOf:date,expectedRevision:snap.stateRevision,
   sourceHash:snap.sourceHash,commandKey:ownerId("admin"),
   reason:"Administrator cannot use owner money",
   moves:[{envelopeId:account,kind:"ASSIGN",signedCents:100}]})).rejects.toThrow(/access/);
  await expect(applyBudgetMoves(owner,{asOf:date,expectedRevision:snap.stateRevision,
   sourceHash:snap.sourceHash,commandKey:ownerId("blocked"),
   reason:"Never fund without owner attestation",
   moves:[{envelopeId:account,kind:"ASSIGN",signedCents:100}]})).rejects.toThrow(/Cannot allocate/);
 });
 it("requires active OWNER and source-bound attestation before budget enabling",async()=>{
  const snap=await getBudgetSnapshot(owner,date);
  await expect(attestBudgetSources(admin,{asOf:date,expectedRevision:snap.stateRevision,
   bankSourceReference:"Synthetic bank statement",cardSourceReference:"Card debt reviewed",
   liabilitySourceReference:"Customer and taxes reviewed",confirmAll:true})).rejects.toThrow(/access/);
  await expect(setBudgetActivation(owner,{enabled:true,startDate:date,
   expectedRevision:snap.stateRevision,reason:"Synthetic bank setup and card review"})).rejects.toThrow(/not ready|not ready:/i);
  await attestBudgetSources(owner,{asOf:date,expectedRevision:snap.stateRevision,
   bankSourceReference:"Synthetic statement through this date",
   cardSourceReference:"Synthetic card obligations independently checked",
   liabilitySourceReference:"Synthetic customer/tax obligations independently checked",confirmAll:true});
  const attested=await getBudgetSnapshot(owner,date);
  expect(attested.mayAssign).toBe(false);
  await setBudgetActivation(owner,{enabled:true,startDate:date,
   expectedRevision:attested.stateRevision,reason:"Source checked for disposable budget test"});
  const enabledBudget=await getBudgetSnapshot(owner,date);
  expect(enabledBudget.enabled).toBe(true);
  expect(enabledBudget.mayAssign).toBe(true);
  expect(enabledBudget.readyCents).toBe(20000);
 });
 it("prevents concurrent overfunding and idempotently returns original revision",async()=>{
  const snap=await getBudgetSnapshot(owner,date);
  const original={asOf:date,expectedRevision:snap.stateRevision,sourceHash:snap.sourceHash,
   reason:"Synthetic owner-directed repair allocation",
   moves:[{envelopeId:account,kind:"ASSIGN" as const,signedCents:15000}]};
  const outcomes=await Promise.allSettled([
   applyBudgetMoves(owner,{...original,commandKey:ownerId("first")}),
   applyBudgetMoves(owner,{...original,commandKey:ownerId("second")})
  ]);
  expect(outcomes.filter(x=>x.status==="fulfilled")).toHaveLength(1);
  const outcome=outcomes.find(x=>x.status==="fulfilled");
  if(outcome?.status!=="fulfilled")throw Error("No committed budget result");
  const retry=await applyBudgetMoves(owner,{...original,commandKey:ownerId("first")})
   .catch(async()=>applyBudgetMoves(owner,{...original,commandKey:ownerId("second")}));
  expect(retry).toBe(outcome.value);
  const after=await getBudgetSnapshot(owner,date);
  expect(after.envelopes.find(x=>x.id===account)?.balanceCents).toBe(15000);
  expect(after.readyCents).toBe(5000);
  await expect(applyBudgetMoves(owner,{...original,expectedRevision:after.stateRevision,
   sourceHash:after.sourceHash,commandKey:ownerId("overdraw")}))
   .rejects.toThrow(/borrow protected|exceeds/);
  await expect(applyBudgetMoves(owner,{...original,commandKey:ownerId("first"),
   moves:[{envelopeId:account,kind:"ASSIGN",signedCents:14000}]}))
   .rejects.toThrow(/different command/);
 });
 it("classifies a posted expense exactly once, blocks protected debt/payments and preserves signed inverse audit",async()=>{
  const expense=await prisma.ledgerAccount.findFirstOrThrow({where:{type:"EXPENSE",active:true}});
  const liability=await prisma.ledgerAccount.findUniqueOrThrow({where:{systemRole:"DEPOSITS_HELD"}});
  const outflow=await prisma.journalEntry.create({data:{
    sourceType:"OPENING",sourceId:ownerId("expense-bank"),eventKind:"OPENING_BALANCE",
    entryDate:day,periodKey:date.slice(0,7),memo:"Synthetic expense paid after bank statement",
    lines:{create:[{ledgerAccountId:bankLedger,creditCents:600},
      {ledgerAccountId:expense.id,debitCents:600}]}},include:{lines:true}});
  additionalEntries.push(outflow.id);
  const spendLine=outflow.lines.find(x=>x.ledgerAccountId===bankLedger)!;
  lineIds.push(spendLine.id);
  const liabilityPayment=await prisma.journalEntry.create({data:{
    sourceType:"OPENING",sourceId:ownerId("liability-bank"),eventKind:"OPENING_BALANCE",
    entryDate:day,periodKey:date.slice(0,7),memo:"Protected customer deposit repayment",
    lines:{create:[{ledgerAccountId:bankLedger,creditCents:200},
      {ledgerAccountId:liability.id,debitCents:200}]}},include:{lines:true}});
  additionalEntries.push(liabilityPayment.id);
  lineIds.push(liabilityPayment.lines.find(x=>x.ledgerAccountId===bankLedger)!.id);
  const snap=await getBudgetSnapshot(owner,date);
  expect(snap.unassignedCount).toBeGreaterThanOrEqual(1);
  expect(snap.mayAssign).toBe(false);
  await expect(assignPostedBankSpending(admin,{journalLineId:spendLine.id,
   splits:[{envelopeId:account,amountCents:600}],commandKey:ownerId("staff-spend"),
   reason:"Admin may not classify protected budget spending"})).rejects.toThrow(/access/);
  await expect(assignPostedBankSpending(owner,{journalLineId:liabilityPayment.lines.find(
   x=>x.ledgerAccountId===bankLedger)!.id,
   splits:[{envelopeId:account,amountCents:200}],commandKey:ownerId("liability-spend"),
   reason:"Synthetic protected customer refund"})).rejects.toThrow(/protected|not discretionary/);
  const item={journalLineId:spendLine.id,splits:[{envelopeId:account,amountCents:600}],
   commandKey:ownerId("expense-spend"),reason:"Synthetic matched posted repair bank payment"};
  const result=await assignPostedBankSpending(owner,item);
  expect(await assignPostedBankSpending(owner,item)).toBe(result);
  await expect(assignPostedBankSpending(owner,{...item,commandKey:ownerId("double-spend")}))
   .rejects.toThrow(/already classified/);
  expect(await prisma.budgetSpendSplit.count({where:{journalLineId:spendLine.id}})).toBe(1);
  expect(await prisma.budgetMove.count({where:{sourceType:"JOURNAL_LINE",sourceId:spendLine.id,kind:"SPEND"}})).toBe(1);
  const corrected=await getBudgetSnapshot(owner,date);
  expect(corrected.unassignedCount).toBe(0);
  expect(corrected.envelopes.find(x=>x.id===account)?.balanceCents).toBe(14400);
  await reversePostedBankSpending(owner,{journalLineId:spendLine.id,
   reason:"Correction: original source assigned wrong cost envelope",expectedRevision:corrected.stateRevision,
   commandKey:ownerId("reverse-spend")});
  expect(await prisma.budgetMove.count({where:{sourceType:"JOURNAL_LINE",sourceId:spendLine.id,kind:"REVERSAL"}})).toBe(1);
  expect(await prisma.budgetSpendSplit.count({where:{journalLineId:spendLine.id}})).toBe(0);
  const reversed=await getBudgetSnapshot(owner,date);
  expect(reversed.envelopes.find(x=>x.id===account)?.balanceCents).toBe(15000);
  expect(reversed.unassignedCount).toBeGreaterThan(0);
  const second=await assignPostedBankSpending(owner,{...item,
   commandKey:ownerId("corrected-spend"),reason:"Corrected allocation after independent source review"});
  expect(second).toBeTruthy();
  expect(await prisma.budgetMove.count({where:{sourceType:"JOURNAL_LINE",
    sourceId:spendLine.id,kind:"SPEND"}})).toBe(2);
 });
 it("releases and undoes only funded positive balances, without inventing a bank transaction",async()=>{
  const snap=await getBudgetSnapshot(owner,date);
  const key=ownerId("release");
  await applyBudgetMoves(owner,{asOf:date,expectedRevision:snap.stateRevision,
   sourceHash:snap.sourceHash,commandKey:key,reason:"Owner adjusts repair funding after review",
   moves:[{envelopeId:account,kind:"RELEASE",signedCents:-1000}]});
  const release=await prisma.budgetMove.findFirstOrThrow({where:{commandKey:key}});
  const current=await getBudgetSnapshot(owner,date);
  expect(current.envelopes.find(x=>x.id===account)?.balanceCents).toBe(14000);
  await undoBudgetMove(owner,{moveId:release.id,expectedRevision:current.stateRevision,
   sourceHash:current.sourceHash,asOf:date,reason:"Source-verified reversal of owner release"});
  const restored=await getBudgetSnapshot(owner,date);
  expect(restored.envelopes.find(x=>x.id===account)?.balanceCents).toBe(15000);
  expect(await prisma.budgetMove.count({where:{reversalOfId:release.id}})).toBe(1);
 });
});