import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openingBalance } from "@/domains/books/posting-rules";
import { writeJournal } from "@/domains/books/post";
import { businessDateFromKey } from "@/lib/business-date";
import {
 correctOpeningBalances,currentOpeningBalances,initializeBooks,
 type BooksActor,
} from "@/domains/books/management";
import { listBooksSetupAttention } from "@/domains/exceptions/books-attention";

const target=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&["localhost","127.0.0.1"].includes(target.hostname)
 &&target.pathname==="/appliance_desk_test";
const tag=randomUUID().slice(0,9),ownerId="ba2-owner-"+tag,adminId="ba2-admin-"+tag;
const date="2023-04-11",month="2023-04";
const owner:BooksActor={id:ownerId,role:"OWNER"},admin:BooksActor={id:adminId,role:"ADMIN"};
const amounts={bankCents:20000,stripeCents:4000,cardCents:6000};
let savedStart:Date|null=null;
let oldPeriod:null|{status:"OPEN"|"CLOSED";closedAt:Date|null;closedByUserId:string|null;reopenedReason:string|null}=null;
const entryWhere={sourceType:"OPENING" as const,sourceId:date};

describe.skipIf(!enabled)("BA-2 owner books setup and corrections on disposable PostgreSQL",()=>{
 beforeAll(async()=>{
  const settings=await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"},
   select:{booksStartDate:true}});
  savedStart=settings.booksStartDate;
  oldPeriod=await prisma.accountingPeriod.findUnique({where:{periodKey:month},
   select:{status:true,closedAt:true,closedByUserId:true,reopenedReason:true}});
  await prisma.user.createMany({data:[
   {id:ownerId,email:ownerId+"@example.test",role:"OWNER"},
   {id:adminId,email:adminId+"@example.test",role:"ADMIN"},
  ]});
  await prisma.businessSettings.update({where:{id:"singleton"},data:{
   booksStartDate:businessDateFromKey(date)!,
  }});
  const plan=openingBalance({date:businessDateFromKey(date)!, ...amounts});
  expect(plan).not.toBeNull();
  await prisma.$transaction(tx=>writeJournal(tx,"OPENING",date,"OPENING_BALANCE",plan!));
 });
 afterAll(async()=>{
  await prisma.journalLine.deleteMany({where:{entry:entryWhere}});
  await prisma.journalEntry.deleteMany({where:entryWhere});
  await prisma.auditLog.deleteMany({where:{userId:{in:[ownerId,adminId]}}});
  if(oldPeriod){
   await prisma.accountingPeriod.update({where:{periodKey:month},data:oldPeriod});
  }else{
   await prisma.accountingPeriod.deleteMany({where:{periodKey:month}});
  }
  await prisma.businessSettings.update({where:{id:"singleton"},data:{booksStartDate:savedStart}});
  await prisma.user.deleteMany({where:{id:{in:[ownerId,adminId]}}});
 });
 it("starts new-business balances at zero and prevents an admin from reinitializing or correcting",async()=>{
  expect(openingBalance({date:businessDateFromKey(date)!,bankCents:0,stripeCents:0,cardCents:0})).toBeNull();
  await expect(initializeBooks(admin,{startDate:date,...amounts})).rejects.toThrow(/OWNER/);
  await expect(correctOpeningBalances(admin,{...amounts,reason:"Admin request"})).rejects.toThrow(/OWNER/);
  const initial=await currentOpeningBalances(owner);
  expect(initial).toMatchObject({...amounts,corrections:0});
 });
 it("writes differences only, preserves the opening, and numbers corrections in order",async()=>{
  const first={bankCents:21000,stripeCents:5000,cardCents:5500,reason:"Bank statement received"};
  expect(await correctOpeningBalances(owner,first)).toEqual({eventKind:"OPENING_CORRECTED_1"});
  expect(await currentOpeningBalances(owner)).toMatchObject({bankCents:first.bankCents,stripeCents:first.stripeCents,cardCents:first.cardCents,corrections:1});
  const entries=await prisma.journalEntry.findMany({where:entryWhere,include:{lines:true}});
  expect(entries.map(x=>x.eventKind).sort()).toEqual(["OPENING_BALANCE","OPENING_CORRECTED_1"]);
  for(const entry of entries)
   expect(entry.lines.reduce((sum,line)=>sum+line.debitCents-line.creditCents,0)).toBe(0);
  expect(entries.find(x=>x.eventKind==="OPENING_BALANCE")?.lines).toHaveLength(4);
  const audit=await prisma.auditLog.findFirstOrThrow({where:{userId:ownerId,
   action:"books.opening.correct"},orderBy:{createdAt:"desc"}});
  expect(audit.newValue).toMatchObject({reason:first.reason,eventKind:"OPENING_CORRECTED_1"});
  await expect(correctOpeningBalances(owner,first)).rejects.toThrow(/already match/);
  expect(await prisma.journalEntry.count({where:entryWhere})).toBe(2);
 });
 it("places a correction after a locked month without changing the closed journal",async()=>{
  await prisma.accountingPeriod.upsert({where:{periodKey:month},
   create:{periodKey:month,status:"CLOSED",closedAt:new Date()},
   update:{status:"CLOSED",closedAt:new Date()},
  });
  const updated={bankCents:22000,stripeCents:5000,cardCents:5500,reason:"Corrected bank starting value"};
  expect(await correctOpeningBalances(owner,updated)).toEqual({eventKind:"OPENING_CORRECTED_2"});
  const row=await prisma.journalEntry.findUniqueOrThrow({where:{sourceType_sourceId_eventKind:{
   ...entryWhere,eventKind:"OPENING_CORRECTED_2",
  }}});
  expect(row.periodKey).not.toBe(month);
  expect(row.lateForDate).not.toBeNull();
  expect(await currentOpeningBalances(owner)).toMatchObject({bankCents:updated.bankCents,stripeCents:updated.stripeCents,cardCents:updated.cardCents,corrections:2});
  const events=await prisma.journalEntry.findMany({where:entryWhere});
  expect(events).toHaveLength(3);
 });
 it("does not double-post a correction when the owner double-submits concurrently",async()=>{
  const values={bankCents:23000,stripeCents:5000,cardCents:5500,reason:"Final statement correction"};
  const attempts=await Promise.allSettled([
   correctOpeningBalances(owner,values),correctOpeningBalances(owner,values),
  ]);
  expect(attempts.filter(x=>x.status==="fulfilled")).toHaveLength(1);
  expect(await prisma.journalEntry.count({where:{...entryWhere,eventKind:"OPENING_CORRECTED_3"}})).toBe(1);
  expect(await currentOpeningBalances(owner)).toMatchObject({bankCents:values.bankCents,stripeCents:values.stripeCents,cardCents:values.cardCents,corrections:3});
 });
 it("shows setup only before initialization and clears it after",async()=>{
  expect(await listBooksSetupAttention()).toHaveLength(0);
  await prisma.businessSettings.update({where:{id:"singleton"},data:{booksStartDate:null}});
  try{
   const before=await listBooksSetupAttention();
   expect(before).toHaveLength(1);
   expect(before[0]).toMatchObject({category:"BOOKS_SETUP",href:"/desk/books/setup"});
  }finally{
   await prisma.businessSettings.update({where:{id:"singleton"},data:{
    booksStartDate:businessDateFromKey(date)!,
   }});
  }
  expect(await listBooksSetupAttention()).toHaveLength(0);
 });
});
