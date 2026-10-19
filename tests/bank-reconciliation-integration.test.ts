import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import { confirmBankMatch,getBankMatchCandidates,ignoreBankObservation,voidBankMatch } from "@/domains/books/cash/matching";
import { completeBankReconciliation,getBankReconciliationHistory,reopenBankReconciliation } from "@/domains/books/cash/reconciliation";
import { readBankCashReadiness } from "@/domains/books/cash/readiness";

const db=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&["localhost","127.0.0.1"].includes(db.hostname)&&
 db.pathname==="/appliance_desk_test";
const tag=randomUUID().slice(0,10),owner="k3-owner-"+tag,admin="k3-admin-"+tag,staff="k3-staff-"+tag;
const bankLedger="k3-bank-"+tag,otherLedger="k3-other-"+tag,offset="k3-offset-"+tag;
const day=(s:string)=>businessDateFromKey(s)!;
let bank="",other="",imp="",obsIds:string[]=[],lineIds:string[]=[],entryIds:string[]=[];
const makeEntry=async(amount:number,where:string)=>{
 const e=await prisma.journalEntry.create({data:{
  sourceType:"OPENING",sourceId:"K3-"+tag+"-"+where,eventKind:"K3_SYNTHETIC_"+where,
  periodKey:"2026-10",entryDate:day("2026-10-16"),memo:"Synthetic verified bank movement",
  lines:{create:[
   {ledgerAccountId:bankLedger,debitCents:Math.max(amount,0),creditCents:Math.max(-amount,0)},
   {ledgerAccountId:offset,debitCents:Math.max(-amount,0),creditCents:Math.max(amount,0)},
  ]},
 }});
 entryIds.push(e.id);
 const l=await prisma.journalLine.findFirstOrThrow({where:{entryId:e.id,ledgerAccountId:bankLedger}});
 lineIds.push(l.id);return l.id;
};
const base=(over:Record<string,unknown>={})=>({
 cashAccountId:bank,from:"2026-10-01",through:"2026-10-18",
 beginningCents:0,endingCents:500,confirmedCompleteThrough:"2026-10-18",
 ownerConfirmedOpening:true,outstandingLineIds:[],sourceReference:"Synthetic bank PDF #123",
 accountVersion:1,...over,
});
describe.skipIf(!enabled)("K-CASH-3 isolated PostgreSQL matching and reconciliation",()=>{
 beforeAll(async()=>{
  await prisma.user.createMany({data:[
   {id:owner,email:owner+"@example.test",role:"OWNER"},
   {id:admin,email:admin+"@example.test",role:"ADMIN"},
   {id:staff,email:staff+"@example.test",role:"STAFF"},
  ]});
  await prisma.ledgerAccount.createMany({data:[
   {id:bankLedger,name:"Synthetic K3 bank "+tag,type:"ASSET",description:"Bank A",isPaymentSource:true},
   {id:otherLedger,name:"Synthetic K3 other bank "+tag,type:"ASSET",description:"Bank B",isPaymentSource:true},
   {id:offset,name:"Synthetic K3 offset "+tag,type:"INCOME",description:"test only"},
  ]});
  const accounts=await Promise.all([prisma.cashAccount.create({data:{
   ledgerAccountId:bankLedger,name:"K3 bank",institutionLabel:"Test institution",
  }}),prisma.cashAccount.create({data:{
   ledgerAccountId:otherLedger,name:"K3 other",institutionLabel:"Test institution",
  }})]);
  bank=accounts[0].id;other=accounts[1].id;
  imp=(await prisma.bankImport.create({data:{cashAccountId:bank,sha256:"aa".repeat(32),
   mapping:{schemaVersion:1,dateColumn:"date"},mappingHash:"bb".repeat(32),
   rowCount:4,importedByUserId:owner}})).id;
  const rows=await Promise.all([800,-300,12,-1].map((c,n)=>prisma.bankObservation.create({data:{
   cashAccountId:bank,importId:imp,rowNumber:n+1,postedOn:day("2026-10-16"),
   signedCents:c,description:"synthetic row "+n,externalId:"K3-"+tag+"-"+n,
   fingerprint:"fp-"+tag+"-"+n,occurrenceIndex:1,
  }})));
  obsIds=rows.map(x=>x.id);
  await makeEntry(700,"a");
  await makeEntry(100,"b");
  await makeEntry(-300,"c");
 });
 afterAll(async()=>{
  const groupIds=(await prisma.bankMatchGroup.findMany({where:{cashAccountId:bank},select:{id:true}})).map(x=>x.id);
  const rec=await prisma.bankReconciliation.findMany({where:{cashAccountId:bank},
    orderBy:{revisionNo:"desc"}});
  for(const row of rec)await prisma.bankReconciliation.delete({where:{id:row.id}});
  await prisma.bankMatchItem.deleteMany({where:{groupId:{in:groupIds}}});
  await prisma.bankMatchGroup.deleteMany({where:{id:{in:groupIds}}});
  await prisma.bankObservation.deleteMany({where:{cashAccountId:bank}});
  await prisma.bankImport.deleteMany({where:{id:imp}});
  await prisma.cashHold.deleteMany({where:{cashAccountId:bank}});
  await prisma.journalLine.deleteMany({where:{entryId:{in:entryIds}}});
  await prisma.journalEntry.deleteMany({where:{id:{in:entryIds}}});
  await prisma.auditLog.deleteMany({where:{userId:{in:[owner,admin,staff]}}});
  await prisma.cashAccount.deleteMany({where:{id:{in:[bank,other]}}});
  await prisma.ledgerAccount.deleteMany({where:{id:{in:[bankLedger,otherLedger,offset]}}});
  await prisma.user.deleteMany({where:{id:{in:[owner,admin,staff]}}});
 });
 it("scopes suggestions by posted bank, date and configured match window",async()=>{
  const result=await getBankMatchCandidates(admin,bank);
  expect(result.bank.bankMatchWindowDays).toBe(7);
  expect(result.observations).toHaveLength(4);
  expect(result.observations.find(x=>x.id===obsIds[1])?.suggestions).toEqual([lineIds[2]]);
  await expect(getBankMatchCandidates(staff,bank)).rejects.toThrow(/access/);
  await expect(getBankMatchCandidates(owner,"foreign-bank")).rejects.toThrow(/active/);
 });
 it("never posts a journal on matching, denies staff and mismatched signed totals",async()=>{
  await expect(confirmBankMatch(staff,{accountId:bank,key:"staff-k3-"+tag,
   observationIds:[obsIds[0]],journalLineIds:lineIds.slice(0,2)})).rejects.toThrow(/access/);
  await expect(confirmBankMatch(owner,{accountId:bank,key:"unbalanced-k3-"+tag,
   observationIds:[obsIds[0]],journalLineIds:[lineIds[0]]})).rejects.toThrow(/same cents/);
  await expect(confirmBankMatch(owner,{accountId:bank,key:"mixed-k3-"+tag,
   observationIds:[obsIds[1],obsIds[0]],journalLineIds:lineIds})).rejects.toThrow(/mixed signs|opposite/);
  expect(await prisma.journalEntry.count({where:{sourceId:{startsWith:"K3-"+tag}}})).toBe(3);
 });
 it("makes one exact 1:many source claim, stable same-key retry and safe parallel rejection",async()=>{
  const selection={accountId:bank,key:"positive-k3-"+tag,
   observationIds:[obsIds[0]],journalLineIds:lineIds.slice(0,2)};
  const successes=await Promise.allSettled([confirmBankMatch(owner,selection),confirmBankMatch(owner,selection)]);
  expect(successes.some(x=>x.status==="fulfilled")).toBe(true);
  const groups=await prisma.bankMatchGroup.findMany({where:{key:selection.key}});
  expect(groups).toHaveLength(1);
  expect(await confirmBankMatch(owner,selection)).toBe(groups[0].id);
  await expect(confirmBankMatch(owner,{...selection,key:"other-k3-"+tag})).rejects.toThrow(/already|used/);
  expect((await prisma.bankObservation.findUniqueOrThrow({where:{id:obsIds[0]}})).status).toBe("MATCHED");
 });
 it("requires a reason for void, leaves original group evidence and allows exact rematch",async()=>{
  const group=await prisma.bankMatchGroup.findUniqueOrThrow({where:{key:"positive-k3-"+tag}});
  await expect(voidBankMatch(admin,group.id,1,"")).rejects.toThrow(/reason/);
  await voidBankMatch(owner,group.id,1,"Bank supplied correction");
  const after=await prisma.bankMatchGroup.findUniqueOrThrow({where:{id:group.id},include:{items:true}});
  expect(after.voidedAt).toBeTruthy();
  expect(after.items).toHaveLength(3);
  expect(after.items.every(x=>!x.active)).toBe(true);
  expect((await prisma.bankObservation.findUniqueOrThrow({where:{id:obsIds[0]}})).status).toBe("UNMATCHED");
  await confirmBankMatch(admin,{accountId:bank,key:"rematch-k3-"+tag,
   observationIds:[obsIds[0]],journalLineIds:lineIds.slice(0,2)});
  await confirmBankMatch(owner,{accountId:bank,key:"negative-k3-"+tag,
   observationIds:[obsIds[1]],journalLineIds:[lineIds[2]]});
 });
 it("refuses unsupported IGNORE and unknown source, accepts reasoned non-account evidence only",async()=>{
  await expect(ignoreBankObservation(staff,obsIds[2],1,"NON_ACCOUNT_ROW","Other account")).rejects.toThrow(/access/);
  await expect(ignoreBankObservation(owner,obsIds[2],1,"DUPLICATE","No verified duplicate")).rejects.toThrow(/no independent/);
  await ignoreBankObservation(owner,obsIds[2],1,"NON_ACCOUNT_ROW","Source file contains bank footer row");
  await ignoreBankObservation(owner,obsIds[3],1,"NON_ACCOUNT_ROW","Source file contains non-account balance memo");
  expect((await prisma.bankObservation.findUniqueOrThrow({where:{id:obsIds[2]}})).status).toBe("IGNORED");
 });
 it("refuses statement opening guess, unresolved activity and any unbalanced ending difference",async()=>{
  await expect(completeBankReconciliation(staff,base())).rejects.toThrow(/access/);
  await expect(completeBankReconciliation(owner,base({ownerConfirmedOpening:false}))).rejects.toThrow(/attest/);
  await expect(completeBankReconciliation(owner,base({beginningCents:1000}))).rejects.toThrow(/beginning differs/);
  await expect(completeBankReconciliation(owner,base({endingCents:499}))).rejects.toThrow(/not zero/);
  expect(await prisma.bankReconciliation.count({where:{cashAccountId:bank}})).toBe(0);
 });
 it("completes immutable zero-difference statement and blocks subsequent match void",async()=>{
  const result=await completeBankReconciliation(owner,base());
  expect(result.bankNet).toBe(500);expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  const history=await getBankReconciliationHistory(admin,bank);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({status:"COMPLETED",isCurrent:true,endingCents:500});
  const group=await prisma.bankMatchGroup.findUniqueOrThrow({where:{key:"negative-k3-"+tag}});
  await expect(voidBankMatch(owner,group.id,1,"Change after statement")).rejects.toThrow(/Reopen/);
  await expect(completeBankReconciliation(owner,base())).rejects.toThrow(/consecutive|Overlapping/);
 });
 it("requires contiguous ranges and preserves ending amount across a second period",async()=>{
  await expect(completeBankReconciliation(owner,base({from:"2026-10-20",through:"2026-10-20",
   endingCents:500,beginningCents:500,confirmedCompleteThrough:"2026-10-20",ownerConfirmedOpening:false})))
   .rejects.toThrow(/consecutive/);
  const second=await completeBankReconciliation(owner,base({from:"2026-10-19",through:"2026-10-19",
   endingCents:500,beginningCents:500,confirmedCompleteThrough:"2026-10-19",ownerConfirmedOpening:false}));
  expect(second.bankNet).toBe(0);
 });
 it("owner reopening invalidates later verifications without deleting immutable evidence",async()=>{
  const history=await getBankReconciliationHistory(owner,bank),first=history.find(x=>businessDateFromKey("2026-10-01")!.getTime()===x.fromOn.getTime())!;
  await expect(reopenBankReconciliation(staff,first.id,1,"correct error")).rejects.toThrow(/access/);
  const result=await reopenBankReconciliation(owner,first.id,1,"Actual bank source evidence changed");
  expect(result.invalidated).toBe(2);
  expect(await prisma.bankReconciliation.count({where:{cashAccountId:bank,status:"COMPLETED",isCurrent:true}})).toBe(0);
  expect((await getBankReconciliationHistory(owner,bank)).every(x=>x.includedEvidence!==null)).toBe(true);
  const view=await readBankCashReadiness(owner,"2026-10-19");
  expect(view.assignableCents).toBe(0);
  expect(view.accounts.find(x=>x.id===bank)?.status).toBe("UNKNOWN");
 });
});
