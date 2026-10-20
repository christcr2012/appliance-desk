import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,describe,expect,it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getBankMatchDesk,confirmBankMatch,voidBankMatch,ignoreBankObservation } from "@/domains/books/cash/matches";
import { createBankReconciliation,completeBankReconciliation,reopenBankReconciliation } from "@/domains/books/cash/reconcile";
import { getCashReadiness,createCashHold,releaseCashHold } from "@/domains/books/cash/cash-readiness";
import { businessDateFromKey,businessDateKey,addBusinessDays } from "@/lib/business-date";

const db=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&["localhost","127.0.0.1"].includes(db.hostname)&&db.pathname==="/appliance_desk_test";
const tag=randomUUID().slice(0,10);
const owner="k-cash-3-owner-"+tag,admin="k-cash-3-admin-"+tag,staff="k-cash-3-staff-"+tag;
const ledger="k-cash-3-bank-"+tag;
let cash="",importId="",first="",match="",reopened="",hold="",oldBooksStart:Date|null=null;
const obsIds:string[]=[],bankLines:string[]=[],sourceIds:string[]=[];
const day=(s:string)=>businessDateFromKey(s)!;
const cmd=(name:string)=>name+"-"+tag;
const statementAttestation={statementSourceReference:"Synthetic bank statement verified independently",confirmedThroughDate:true};
describe.skipIf(!enabled)("K-CASH-3 disposable Postgres match and statement proof",()=>{
 beforeAll(async()=>{
  oldBooksStart=(await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"}})).booksStartDate;
  await prisma.businessSettings.update({where:{id:"singleton"},data:{booksStartDate:day("2026-01-01")}});
  await prisma.user.createMany({data:[
   {id:owner,email:owner+"@example.test",role:"OWNER"},
   {id:admin,email:admin+"@example.test",role:"ADMIN"},
   {id:staff,email:staff+"@example.test",role:"STAFF"}]});
  const equity=await prisma.ledgerAccount.findUniqueOrThrow({where:{systemRole:"OWNER_CONTRIBUTIONS"}});
  await prisma.ledgerAccount.create({data:{id:ledger,name:"Synthetic matching cash account",description:"Synthetic fixture",type:"ASSET",isPaymentSource:true}});
  cash=(await prisma.cashAccount.create({data:{ledgerAccountId:ledger,name:"Synthetic checking",
   institutionLabel:"Local fixture",bankMatchWindowDays:7}})).id;
  importId=(await prisma.bankImport.create({data:{cashAccountId:cash,sha256:"a".repeat(64),
   mappingHash:"b".repeat(64),mapping:{schemaVersion:1},rowCount:2,importedByUserId:owner}})).id;
  for(const [i,value] of [150,250].entries()){
   const obs=await prisma.bankObservation.create({data:{cashAccountId:cash,importId,
    rowNumber:i+1,postedOn:day("2026-10-15"),signedCents:value,
    description:"Synthetic matching receipt "+i,fingerprint:String(i).repeat(64),occurrenceIndex:1}});
   obsIds.push(obs.id);
  }
  for(const [i,value] of [100,300].entries()){
   const sourceId=cmd("journal-"+i);sourceIds.push(sourceId);
   const entry=await prisma.journalEntry.create({data:{sourceType:"OPENING",sourceId,
    eventKind:"OPENING_BALANCE",entryDate:day("2026-10-15"),periodKey:"2026-10",
    memo:"Synthetic bank proof "+i,lines:{create:[
     {ledgerAccountId:ledger,debitCents:value},
     {ledgerAccountId:equity.id,creditCents:value}]}} ,
    include:{lines:true}});
   bankLines.push(entry.lines.find(x=>x.ledgerAccountId===ledger)!.id);
  }
 });
 afterAll(async()=>{
  await prisma.bankMatchItem.deleteMany({where:{group:{cashAccountId:cash}}});
  await prisma.bankMatchGroup.deleteMany({where:{cashAccountId:cash}});
  const all=await prisma.bankReconciliation.findMany({where:{cashAccountId:cash}});
  for(const row of all.sort((a,b)=>b.revisionNo-a.revisionNo))
   await prisma.bankReconciliation.delete({where:{id:row.id}});
  await prisma.cashHold.deleteMany({where:{cashAccountId:cash}});
  await prisma.bankObservation.deleteMany({where:{cashAccountId:cash}});
  await prisma.bankImport.deleteMany({where:{cashAccountId:cash}});
  await prisma.journalLine.deleteMany({where:{entry:{sourceId:{in:sourceIds}}}});
  await prisma.journalEntry.deleteMany({where:{sourceId:{in:sourceIds}}});
  await prisma.auditLog.deleteMany({where:{userId:{in:[owner,admin,staff]}}});
  await prisma.cashAccount.deleteMany({where:{id:cash}});
  await prisma.ledgerAccount.deleteMany({where:{id:ledger}});
  await prisma.user.deleteMany({where:{id:{in:[owner,admin,staff]}}});
  await prisma.businessSettings.update({where:{id:"singleton"},data:{booksStartDate:oldBooksStart}});
 });
 it("resolves Colorado spring and fall statement calendar transitions without UTC-day shortcuts",()=>{
  const spring=day("2026-03-08"),next=addBusinessDays(spring,1);
  expect(businessDateKey(next)).toBe("2026-03-09");
  expect((next.getTime()-spring.getTime())/3600000).toBe(23);
  const fall=day("2026-11-01"),after=addBusinessDays(fall,1);
  expect(businessDateKey(after)).toBe("2026-11-02");
  expect((after.getTime()-fall.getTime())/3600000).toBe(25);
  expect(businessDateFromKey("2026-02-30")).toBeNull();
 });
 it("rejects staff and does not auto-match approximate or unrelated values",async()=>{
  await expect(getBankMatchDesk(staff,cash)).rejects.toThrow(/access/);
  const desk=await getBankMatchDesk(admin,cash);
  expect(desk.observations).toHaveLength(2);
  expect(desk.suggestions.every(x=>x.candidates.length===0)).toBe(true);
  await expect(confirmBankMatch(staff,{accountId:cash,commandKey:cmd("staff"),
   observationIds:obsIds,journalLineIds:bankLines})).rejects.toThrow(/access/);
  await expect(confirmBankMatch(owner,{accountId:cash,commandKey:cmd("unbalanced"),
   observationIds:[obsIds[0]!],journalLineIds:[bankLines[0]!]})).rejects.toThrow(/exact signed/);
 });
 it("commits one exact 2:2 match group and serializes conflicting claims",async()=>{
  const input={accountId:cash,commandKey:cmd("group"),observationIds:obsIds,journalLineIds:bankLines,
   observationVersions:Object.fromEntries(obsIds.map(id=>[id,1]))};
  const attempts=await Promise.allSettled([confirmBankMatch(owner,input),confirmBankMatch(owner,input)]);
  expect(attempts.some(x=>x.status==="fulfilled")).toBe(true);
  const rows=await prisma.bankMatchGroup.findMany({where:{cashAccountId:cash},include:{items:true}});
  expect(rows).toHaveLength(1);expect(rows[0]!.items).toHaveLength(4);
  match=rows[0]!.id;
  expect(await confirmBankMatch(owner,input)).toBe(match);
  await expect(confirmBankMatch(admin,{...input,commandKey:cmd("another")})).rejects.toThrow(/stale|claimed/);
  expect(await prisma.bankMatchItem.count({where:{groupId:match,active:true}})).toBe(4);
 });
 it("refuses unverified openings, gaps, partial sources and ADMIN completion",async()=>{
  await expect(createBankReconciliation(admin,{...statementAttestation,accountId:cash,fromDate:"2026-10-15",
   toDate:"2026-10-16",beginningCents:0,endingCents:400})).rejects.toThrow(/access/);
  await expect(createBankReconciliation(owner,{...statementAttestation,confirmedThroughDate:false,
   accountId:cash,fromDate:"2026-10-15",toDate:"2026-10-16",beginningCents:0,endingCents:400}))
   .rejects.toThrow(/statement source/);
  await expect(createBankReconciliation(owner,{...statementAttestation,accountId:cash,fromDate:"2026-10-15",
   toDate:"2026-10-16",beginningCents:0,endingCents:400})).rejects.toThrow(/First statement/);
  first=await createBankReconciliation(owner,{...statementAttestation,accountId:cash,fromDate:"2026-10-15",
   toDate:"2026-10-16",beginningCents:0,endingCents:400,
   firstStatement:{bookBeginningCents:0,preStartOutstandingCents:0,sourceReference:"Synthetic checked source"}});
  await expect(completeBankReconciliation(admin,first,1)).rejects.toThrow(/access/);
  await expect(createBankReconciliation(owner,{...statementAttestation,accountId:cash,fromDate:"2026-10-18",
   toDate:"2026-10-19",beginningCents:400,endingCents:400})).rejects.toThrow(/pending/);
 });
 it("freezes exact bank/book group proof and blocks historical reclassification",async()=>{
  const proof=await completeBankReconciliation(owner,first,1);
  expect(proof).toMatchObject({observationSumCents:400,journalMatchedSumCents:400,
   bankDifferenceCents:0});
  expect(proof.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  expect(proof.bankStatement).toMatchObject({throughDate:"2026-10-16",
   sourceReference:statementAttestation.statementSourceReference});
  expect(proof.lines).toHaveLength(2);
  await expect(completeBankReconciliation(owner,first,1)).rejects.toThrow(/already completed|changed/);
  await expect(voidBankMatch(admin,match,1,"Wrong prior review")).rejects.toThrow(/Reopen/);
  await expect(ignoreBankObservation(owner,obsIds[0]!,2,"DUPLICATE","Synthetic")).rejects.toThrow(/Matched|stale/);
  const current=await prisma.bankReconciliation.findUniqueOrThrow({where:{id:first}});
  expect(current.includedEvidence).toMatchObject({sourceHash:proof.sourceHash});
  await expect(createBankReconciliation(owner,{...statementAttestation,accountId:cash,fromDate:"2026-10-18",
   toDate:"2026-10-18",beginningCents:400,endingCents:400})).rejects.toThrow(/day after/);
 });
 it("reads reconciled money, protects an audited hold and refuses staff disclosure",async()=>{
  const base=await getCashReadiness(owner,"2026-10-18");
  const bank=base.banks.find(x=>x.id===cash)!;
  expect(bank.endingCents).toBe(400);
  expect(bank.eligibleCents).toBe(400);
  expect(bank.bookDifferenceCents).toBe(0);
  expect(base.mayFund).toBe(false);
  hold=await createCashHold(owner,{accountId:cash,amountCents:25,
   effectiveDate:"2026-10-16",reason:"Synthetic possible unsettled bank debit"});
  const adjusted=await getCashReadiness(admin,"2026-10-18");
  const held=adjusted.banks.find(x=>x.id===cash)!;
  expect(held.eligibleCents).toBe(375);
  expect(held.holdsCents).toBe(25);
  expect(held.bookDifferenceCents).toBe(0);
  await expect(getCashReadiness(staff,"2026-10-18")).rejects.toThrow(/access/);
  await expect(releaseCashHold(admin,hold,1,"Documented settlement evidence")).rejects.toThrow(/access/);
  await releaseCashHold(owner,hold,1,"Independent bank evidence cleared this hold");
  await expect(releaseCashHold(owner,hold,1,"Second clearance attempt")).rejects.toThrow(/released|changed/);
 });
 it("retains original completion hash when owner reopens and refuses stale actions",async()=>{
  reopened=await reopenBankReconciliation(owner,first,2,"Owner confirmed a corrected statement source");
  const before=await prisma.bankReconciliation.findUniqueOrThrow({where:{id:first}});
  const current=await prisma.bankReconciliation.findUniqueOrThrow({where:{id:reopened}});
  expect(before.status).toBe("COMPLETED");expect(before.isCurrent).toBe(false);
  expect(current).toMatchObject({status:"REOPENED",isCurrent:true,revisionNo:2,
   priorCompletedId:first});
  await expect(reopenBankReconciliation(owner,first,2,"Repeated")).rejects.toThrow(/Only the current/);
  await expect(completeBankReconciliation(owner,first,2)).rejects.toThrow(/replaced/);
  const proof=await completeBankReconciliation(owner,reopened,1);
  expect(proof.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  expect(proof.firstStatement).toMatchObject({sourceReference:"Synthetic checked source"});
  expect(proof.bankStatement).toMatchObject({sourceReference:statementAttestation.statementSourceReference});
 });
 it("rejects cross-account book lines, protects unmatched debits and proves negative signed bank clearance",async()=>{
  const equity=await prisma.ledgerAccount.findUniqueOrThrow({where:{systemRole:"OWNER_CONTRIBUTIONS"}});
  const nextImport=await prisma.bankImport.create({data:{cashAccountId:cash,
   sha256:"c".repeat(64),mappingHash:"d".repeat(64),mapping:{schemaVersion:1},
   rowCount:2,importedByUserId:owner}});
  const debit=await prisma.bankObservation.create({data:{cashAccountId:cash,importId:nextImport.id,
   rowNumber:1,postedOn:day("2026-10-18"),signedCents:-40,
   description:"Verified synthetic outflow",fingerprint:"e".repeat(64),occurrenceIndex:1}});
  const possibleDuplicate=await prisma.bankObservation.create({data:{cashAccountId:cash,importId:nextImport.id,
   rowNumber:2,postedOn:day("2026-10-18"),signedCents:10,
   description:"Verified imported duplicate",fingerprint:"f".repeat(64),occurrenceIndex:1}});
  const sourceId=cmd("late-outflow");sourceIds.push(sourceId);
  const book=await prisma.journalEntry.create({data:{
   sourceType:"OPENING",sourceId,eventKind:"OPENING_BALANCE",entryDate:day("2026-10-18"),
   periodKey:"2026-10",memo:"Synthetic post-statement bank debit",
   lines:{create:[
    {ledgerAccountId:ledger,creditCents:40},
    {ledgerAccountId:equity.id,debitCents:40}
   ]}},include:{lines:true}});
  const bankLine=book.lines.find(x=>x.ledgerAccountId===ledger)!.id;
  const equityLine=book.lines.find(x=>x.ledgerAccountId===equity.id)!.id;
  await expect(confirmBankMatch(owner,{accountId:cash,commandKey:cmd("cross-ledger"),
   observationIds:[debit.id],journalLineIds:[equityLine]}))
   .rejects.toThrow(/stale|claimed/);
  const unmatched=await getCashReadiness(owner,"2026-10-18");
  const before=unmatched.banks.find(x=>x.id===cash)!;
  expect(before.unmatchedCount).toBe(2);
  expect(before.status).toBe("UNKNOWN");
  expect(before.eligibleCents).toBe(360);
  const negativeGroup=await confirmBankMatch(admin,{accountId:cash,
   commandKey:cmd("negative-clear"),observationIds:[debit.id],journalLineIds:[bankLine]});
  expect(await prisma.bankMatchItem.count({where:{groupId:negativeGroup,active:true}})).toBe(2);
  await expect(ignoreBankObservation(admin,possibleDuplicate.id,1,"DUPLICATE","Independently identified duplicate row"))
   .rejects.toThrow(/access/);
  await ignoreBankObservation(owner,possibleDuplicate.id,1,"DUPLICATE",
   "Duplicate verified from independent statement transaction identifier");
  expect((await prisma.bankObservation.findUniqueOrThrow({where:{id:possibleDuplicate.id}})).status)
   .toBe("IGNORED");
  const ready=await getCashReadiness(owner,"2026-10-18");
  const bank=ready.banks.find(x=>x.id===cash)!;
  expect(bank).toMatchObject({endingCents:400,bookOutflowsCents:40,
   clearedLaterInflowsCents:0,eligibleCents:360,
   bookDifferenceCents:0,unmatchedCount:0});
  expect(ready.mayFund).toBe(false);
  const next=await createBankReconciliation(owner,{...statementAttestation,
   accountId:cash,fromDate:"2026-10-17",toDate:"2026-10-18",
   beginningCents:400,endingCents:360});
  const nextProof=await completeBankReconciliation(owner,next,1);
  expect(nextProof).toMatchObject({observationSumCents:-40,
   journalMatchedSumCents:-40,bankDifferenceCents:0});
  await expect(reopenBankReconciliation(owner,reopened,2,
   "Recheck prior evidence after next statement completion"))
    .rejects.toThrow(/reverse chronological/);
 });
});
