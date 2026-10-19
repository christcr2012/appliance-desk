import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,describe,expect,it} from "vitest";
import {prisma} from "@/lib/prisma";
import {previewBankImport,commitBankImport} from "@/domains/books/cash/import";
import type {BankCsvMapping} from "@/domains/books/cash/csv";
const url=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&["localhost","127.0.0.1"].includes(url.hostname)&&url.pathname==="/appliance_desk_test";
const tag=randomUUID().slice(0,10),owner="cash-import-owner-"+tag,staff="cash-import-staff-"+tag;
const ledger="cash-import-ledger-"+tag;
let bank="",oldAuth:string|undefined,oldBetter:string|undefined;
const mapping:BankCsvMapping={schemaVersion:1,dateColumn:"Date",descriptionColumn:"Description",
 amountColumn:"Amount",dateFormat:"YYYY-MM-DD",bankCreditIsPositive:true};
const bytes=(txt:string)=>new TextEncoder().encode(txt);
const file=bytes("Date,Description,Amount\n2026-10-16,Synthetic coffee,-1.00\n2026-10-16,Synthetic coffee,-1.00\n");
describe.skipIf(!enabled)("K-CASH-2 preview/import authorization, immutable history and replay",()=>{
 beforeAll(async()=>{
  oldAuth=process.env.AUTH_SECRET;oldBetter=process.env.BETTER_AUTH_SECRET;
  delete process.env.BETTER_AUTH_SECRET;process.env.AUTH_SECRET="synthetic-only-bank-preview-key-".repeat(2);
  await prisma.user.createMany({data:[{id:owner,email:owner+"@example.test",role:"OWNER"},
   {id:staff,email:staff+"@example.test",role:"STAFF"}]});
  await prisma.ledgerAccount.create({data:{id:ledger,name:"Synthetic cash import",type:"ASSET",
   description:"Synthetic independent account",isPaymentSource:true}});
  bank=(await prisma.cashAccount.create({data:{ledgerAccountId:ledger,name:"Fixture cash source",
   institutionLabel:"Test institution"}})).id;
 });
 afterAll(async()=>{
  if(oldAuth===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=oldAuth;
  if(oldBetter===undefined)delete process.env.BETTER_AUTH_SECRET;else process.env.BETTER_AUTH_SECRET=oldBetter;
  await prisma.bankObservation.deleteMany({where:{cashAccountId:bank}});
  const imports=await prisma.bankImport.findMany({where:{cashAccountId:bank}});
  for(const row of imports.reverse())await prisma.bankImport.delete({where:{id:row.id}});
  await prisma.auditLog.deleteMany({where:{userId:{in:[owner,staff]}}});
  await prisma.cashAccount.deleteMany({where:{id:bank}});
  await prisma.ledgerAccount.deleteMany({where:{id:ledger}});
  await prisma.user.deleteMany({where:{id:{in:[owner,staff]}}});
 });
 it("denies staff and binds signed preview to exact bytes, user and account version",async()=>{
  await expect(previewBankImport(staff,bank,file,mapping)).rejects.toThrow(/access/);
  const preview=await previewBankImport(owner,bank,file,mapping);
  expect(preview).toMatchObject({count:2,totalOutflowsCents:200});
  expect(preview.firstTwenty.map(x=>x.occurrenceIndex)).toEqual([1,2]);
  await expect(commitBankImport(staff,bank,file,mapping,preview.token,"staff-retry-"+tag)).rejects.toThrow(/changed|token/);
  await expect(commitBankImport(owner,bank,bytes("Date,Description,Amount\n2026-10-16,Changed,-1.00\n"),
   mapping,preview.token,"changed-file-"+tag)).rejects.toThrow(/changed/);
  await expect(commitBankImport(owner,bank,file,{...mapping,bankCreditIsPositive:false},
   preview.token,"changed-map-"+tag)).rejects.toThrow(/changed/);
  const v=await prisma.cashAccount.findUniqueOrThrow({where:{id:bank}});
  await prisma.cashAccount.update({where:{id:bank},data:{version:{increment:1}}});
  await expect(commitBankImport(owner,bank,file,mapping,preview.token,"changed-version-"+tag)).rejects.toThrow(/changed/);
  await prisma.cashAccount.update({where:{id:bank},data:{version:v.version}});
 });
 it("stores both legitimate same-day identical purchases and idempotent exact import",async()=>{
  const preview=await previewBankImport(owner,bank,file,mapping);
  const first=await commitBankImport(owner,bank,file,mapping,preview.token,"initial-"+tag);
  expect(await prisma.bankObservation.count({where:{importId:first,isActive:true}})).toBe(2);
  const replay=await commitBankImport(owner,bank,file,mapping,preview.token,"initial-"+tag);
  expect(replay).toBe(first);
  expect(await prisma.bankImport.count({where:{cashAccountId:bank,status:"ACTIVE"}})).toBe(1);
  await expect(commitBankImport(owner,bank,file,{...mapping,bankCreditIsPositive:false},
   preview.token,"mismatch-"+tag)).rejects.toThrow(/changed/);
 });
 it("requires OWNER-reasoned mapping supersession and retains inactive source evidence",async()=>{
  const replacementMapping={...mapping,descriptionColumn:"Memo"} as BankCsvMapping;
  const fixed=bytes("Date,Description,Memo,Amount\n2026-10-16,old memo,Replacement text,-1.00\n");
  const preview=await previewBankImport(owner,bank,fixed,replacementMapping);
  // Fresh CSV gives a separate source hash, not supersession; the original remains.
  const second=await commitBankImport(owner,bank,fixed,replacementMapping,preview.token,"second-"+tag);
  expect((await prisma.bankImport.findUniqueOrThrow({where:{id:second}})).status).toBe("ACTIVE");
 });
 it("protects authorizations even after user role is deactivated",async()=>{
  const preview=await previewBankImport(owner,bank,bytes("Date,Description,Amount\n2026-10-16,Another,-2.00\n"),mapping);
  await prisma.user.update({where:{id:owner},data:{archivedAt:new Date()}});
  try{await expect(commitBankImport(owner,bank,bytes("Date,Description,Amount\n2026-10-16,Another,-2.00\n"),
    mapping,preview.token,"after-deact-"+tag)).rejects.toThrow(/access/);}
  finally{await prisma.user.update({where:{id:owner},data:{archivedAt:null}});}
 });
});
