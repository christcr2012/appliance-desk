import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,describe,expect,it } from "vitest";
import { prisma } from "@/lib/prisma";
const url=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&["localhost","127.0.0.1"].includes(url.hostname)&&url.pathname==="/appliance_desk_test";
const t=randomUUID().slice(0,9),ledger="cash-schema-ledger-"+t;
let account="",one="",group="";
describe.skipIf(!enabled)("K-CASH-1 additive source evidence constraints on disposable PostgreSQL",()=>{
 beforeAll(async()=>{
  await prisma.ledgerAccount.create({data:{id:ledger,name:"Cash schema bank "+t,type:"ASSET",description:"Synthetic bank",isPaymentSource:true}});
  account=(await prisma.cashAccount.create({data:{ledgerAccountId:ledger,name:"Synthetic local",institutionLabel:"Fixture Bank",lastFour:"1234"}})).id;
  one=(await prisma.bankImport.create({data:{cashAccountId:account,sha256:"a".repeat(64),
   mappingHash:"b".repeat(64),mappingRevision:1,mapping:{schemaVersion:1},rowCount:1,importedByUserId:"synthetic-owner"}})).id;
  group=(await prisma.bankMatchGroup.create({data:{cashAccountId:account,key:"test-group-"+t,createdByUserId:"synthetic-owner"}})).id;
 });
 afterAll(async()=>{
  await prisma.bankMatchItem.deleteMany({where:{groupId:group}});
  await prisma.bankMatchGroup.deleteMany({where:{id:group}});
  await prisma.bankObservation.deleteMany({where:{cashAccountId:account}});
  await prisma.bankImport.deleteMany({where:{cashAccountId:account}});
  await prisma.bankReconciliation.deleteMany({where:{cashAccountId:account}});
  await prisma.cashHold.deleteMany({where:{cashAccountId:account}});
  await prisma.cashAccount.deleteMany({where:{id:account}});
  await prisma.ledgerAccount.deleteMany({where:{id:ledger}});
 });
 it("preserves one active bank interpretation per source hash with revision history",async()=>{
  await expect(prisma.bankImport.create({data:{cashAccountId:account,sha256:"a".repeat(64),
   mappingHash:"c".repeat(64),mappingRevision:2,mapping:{schemaVersion:1},rowCount:1,
   importedByUserId:"synthetic-owner"}})).rejects.toThrow();
  await prisma.bankImport.update({where:{id:one},data:{status:"SUPERSEDED",supersededAt:new Date(),
   supersededByUserId:"synthetic-owner",supersededReason:"Corrected parser mapping"}});
  const replacement=await prisma.bankImport.create({data:{cashAccountId:account,sha256:"a".repeat(64),
   mappingHash:"c".repeat(64),mappingRevision:2,mapping:{schemaVersion:1},rowCount:1,
   importedByUserId:"synthetic-owner",supersedesImportId:one}});
  expect(replacement.mappingRevision).toBe(2);
  expect((await prisma.bankImport.findUniqueOrThrow({where:{id:one}})).status).toBe("SUPERSEDED");
 });
 it("refuses duplicate active transaction IDs, retaining separate same-fingerprint occurrences",async()=>{
  const current=await prisma.bankImport.findFirstOrThrow({where:{cashAccountId:account,status:"ACTIVE"}});
  await prisma.bankObservation.create({data:{cashAccountId:account,importId:current.id,rowNumber:1,
   postedOn:new Date("2026-10-15T06:00:00Z"),signedCents:-99,description:"Synthetic identical shop",
   fingerprint:"d".repeat(64),occurrenceIndex:1,externalId:"id-"+t}});
  const next=await prisma.bankImport.create({data:{cashAccountId:account,sha256:"e".repeat(64),
   mappingHash:"f".repeat(64),mappingRevision:1,mapping:{schemaVersion:1},
   rowCount:2,importedByUserId:"synthetic-owner"}});
  await expect(prisma.bankObservation.create({data:{cashAccountId:account,importId:next.id,rowNumber:1,
   postedOn:new Date("2026-10-15T06:00:00Z"),signedCents:-99,description:"Synthetic duplicate",
   fingerprint:"d".repeat(64),occurrenceIndex:2,externalId:"id-"+t}})).rejects.toThrow();
  const legitimate=await prisma.bankObservation.create({data:{cashAccountId:account,importId:next.id,rowNumber:2,
   postedOn:new Date("2026-10-15T06:00:00Z"),signedCents:-99,description:"Synthetic identical shop",
   fingerprint:"d".repeat(64),occurrenceIndex:2}});
  expect(legitimate.occurrenceIndex).toBe(2);
  await expect(prisma.bankMatchItem.create({data:{groupId:group,bankObservationId:legitimate.id,
   journalLineId:"wrong",signedCents:-99}})).rejects.toThrow();
  await prisma.bankMatchItem.create({data:{groupId:group,bankObservationId:legitimate.id,signedCents:-99}});
  await expect(prisma.bankMatchItem.create({data:{groupId:group,bankObservationId:legitimate.id,signedCents:-99}})).rejects.toThrow();
 });
 it("enforces one current statement revision and bounded matching policy in PostgreSQL",async()=>{
  await expect(prisma.cashAccount.update({where:{id:account},data:{bankMatchWindowDays:31}})).rejects.toThrow();
  const from=new Date("2026-10-01T06:00:00Z"),to=new Date("2026-10-16T06:00:00Z");
  await prisma.bankReconciliation.create({data:{cashAccountId:account,fromOn:from,toOn:to,
   beginningCents:0,endingCents:0}});
  await expect(prisma.bankReconciliation.create({data:{cashAccountId:account,fromOn:from,toOn:to,
   beginningCents:0,endingCents:0,revisionNo:2}})).rejects.toThrow();
 });
});
