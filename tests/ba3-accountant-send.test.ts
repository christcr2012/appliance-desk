import { beforeEach, describe, expect, it, vi } from "vitest";

const m=vi.hoisted(()=>({
 send:vi.fn(),authorized:vi.fn(),settings:vi.fn(),period:vi.fn(),
 entries:vi.fn(),report:vi.fn(),upsert:vi.fn(),audit:vi.fn(),
}));
vi.mock("@/lib/team-actor",()=>({assertActiveTeamActor:m.authorized}));
vi.mock("@/lib/email",()=>({sendEmail:m.send}));
vi.mock("@/domains/books/reports",()=>({profitAndLoss:m.report}));
vi.mock("@/lib/prisma",()=>({prisma:{
 $transaction:async(work:(tx:unknown)=>Promise<unknown>)=>work({
  accountingPeriod:{findUnique:m.period,upsert:m.upsert},
  auditLog:{create:m.audit},
 }),
 businessSettings:{findUniqueOrThrow:m.settings},
 accountingPeriod:{findUnique:m.period},
 journalEntry:{findMany:m.entries},
}}));
import { sendMonthToAccountant } from "@/domains/books/accountant-packet";

const owner={id:"test-owner",role:"OWNER" as const};
const key="2020-01";
let sentAt:Date|null;
describe("BA-3 accountant send guard and outcome evidence",()=>{
 beforeEach(()=>{
  vi.clearAllMocks();
  sentAt=null;
  m.authorized.mockResolvedValue(undefined);
  m.settings.mockResolvedValue({
   booksStartDate:new Date("2020-01-01T07:00:00Z"),accountantEmail:"accountant@example.test",
  });
  m.period.mockImplementation(async()=>sentAt?{accountantSentAt:sentAt}:null);
  m.entries.mockResolvedValue([]);
  m.report.mockResolvedValue({summary:{
   rows:[],incomeCents:0,reductionsCents:0,expenseCents:0,netProfitCents:0,
  }});
  m.upsert.mockImplementation(async()=>{
   sentAt=new Date("2026-10-26T13:00:00Z");
  });
  m.audit.mockResolvedValue(undefined);
 });
 it("never sends accountant data for a non-owner",async()=>{
  await expect(sendMonthToAccountant({id:"admin",role:"ADMIN"},key))
   .rejects.toThrow(/Only the owner/);
  expect(m.send).not.toHaveBeenCalled();
 });
 it.each([
  ["UNKNOWN","couldn't tell"],
  ["REJECTED","refused"],
  ["NOT_ATTEMPTED","isn't set up"],
 ] as const)("does not mark a %s email as delivered",async(outcome,text)=>{
  m.send.mockResolvedValue({sent:false,outcome});
  const result=await sendMonthToAccountant(owner,key);
  expect(result.outcome).toBe(outcome);
  expect(result.message).toContain(text);
  expect(m.upsert).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
  expect(m.send).toHaveBeenCalledTimes(1);
  expect(m.send).toHaveBeenCalledWith(expect.objectContaining({
   to:"accountant@example.test",
   idempotencyKey:"books-accountant-2020-01",
   attachments:expect.arrayContaining([
    expect.objectContaining({filename:"books-journal-2020-01.csv",content:expect.any(Buffer)}),
    expect.objectContaining({filename:"books-profit-2020-01.csv",content:expect.any(Buffer)}),
   ]),
  }));
 });
 it("records provider acceptance once and refuses to send the same month a second time",async()=>{
  m.send.mockResolvedValue({sent:true,outcome:"SENT",providerMessageId:"test-accepted-message"});
  expect((await sendMonthToAccountant(owner,key)).outcome).toBe("SENT");
  expect(m.upsert).toHaveBeenCalledTimes(1);
  expect(m.audit).toHaveBeenCalledWith({data:expect.objectContaining({
   action:"books.review.accountant-sent",
   newValue:{outcome:"SENT",providerMessageId:"test-accepted-message"},
  })});
  const again=await sendMonthToAccountant(owner,key);
  expect(again.message).toMatch(/already accepted/);
  expect(m.send).toHaveBeenCalledOnce();
  expect(m.upsert).toHaveBeenCalledOnce();
 });
});
