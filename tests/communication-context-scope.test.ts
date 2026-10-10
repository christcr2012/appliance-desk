import {describe,expect,it,vi,beforeEach} from "vitest";
const db=vi.hoisted(()=>({
  job:{findFirst:vi.fn()},
  maintenanceRequest:{findFirst:vi.fn()},
  invoice:{findFirst:vi.fn()},
  messageDelivery:{findMany:vi.fn()},
  communicationLink:{findMany:vi.fn()},
}));
const guard=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/prisma",()=>({prisma:db}));
vi.mock("@/lib/session",()=>({requireRole:guard}));
import {contextStateLabel,getContextEvidence,recentContextEvidence} from "@/domains/messaging/context-evidence";

const day=new Date("2026-10-10T12:00:00Z");
beforeEach(()=>{
 vi.clearAllMocks();
 guard.mockResolvedValue({user:{id:"owner-1",role:"OWNER"}});
 db.job.findFirst.mockResolvedValue(null);
 db.maintenanceRequest.findFirst.mockResolvedValue({customerId:"customer-1"});
 db.invoice.findFirst.mockResolvedValue({customerId:"customer-1"});
 db.messageDelivery.findMany.mockResolvedValue([]);
 db.communicationLink.findMany.mockResolvedValue([]);
});
describe("COM-L14B contextual facts",()=>{
 it("does not interpret accepted as delivered or suppressed as unknown",()=>{
  expect(contextStateLabel("ACCEPTED")).toMatch(/not confirmed delivered/);
  expect(contextStateLabel("DELIVERED")).toMatch(/confirmed/);
  expect(contextStateLabel("SUPPRESSED")).toMatch(/not sent/);
  expect(contextStateLabel("UNKNOWN")).toMatch(/verify before retry/);
 });
 it("rejects staff billing and only reads explicitly assigned job",async()=>{
  guard.mockResolvedValue({user:{id:"staff-9",role:"STAFF"}});
  expect((await getContextEvidence("Invoice","invoice-1")).restricted).toBe(true);
  expect((await getContextEvidence("Job","job-1")).restricted).toBe(true);
  expect(db.messageDelivery.findMany).not.toHaveBeenCalled();
  expect(db.job.findFirst).toHaveBeenCalledWith({
    where:{id:"job-1",assignedToUserId:"staff-9"},select:{customerId:true},
  });
 });
 it("shows safe assigned-job facts without private drill-through",async()=>{
  guard.mockResolvedValue({user:{id:"staff-9",role:"STAFF"}});
  db.job.findFirst.mockResolvedValue({id:"job-1"});
  db.messageDelivery.findMany.mockResolvedValue([
   {id:"d1",channel:"SMS",state:"ACCEPTED",requestedAt:day,
    communicationMessage:{threadId:"private-thread"}},
  ]);
  const result=await getContextEvidence("Job","job-1");
  expect(result.entries).toHaveLength(1);
  expect(result.entries[0]).toMatchObject({status:expect.stringContaining("not confirmed delivered"),href:null});
  expect(JSON.stringify(result)).not.toContain("private-thread");
  expect(db.messageDelivery.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where:{subjectType:"Job",subjectId:"job-1"},take:26,
  }));
 });
 it("requires explicit context keys and deduplicates one delivery",async()=>{
  db.messageDelivery.findMany.mockResolvedValue([
   {id:"d1",channel:"SMS",state:"DELIVERED",requestedAt:day,
    communicationMessage:{threadId:"private-thread"}},
  ]);
  db.communicationLink.findMany.mockResolvedValue([
   {message:{id:"m1",occurredAt:day,direction:"OUTBOUND",threadId:"private-thread",
    delivery:{id:"d1",state:"DELIVERED"}}},
  ]);
  const result=await getContextEvidence("MaintenanceRequest","mr-1");
  expect(result.entries).toHaveLength(1);
  expect(result.entries[0].source).toBe("EXPLICIT_LINK");
  expect(result.entries[0].href).toContain("private-thread");
  expect(db.communicationLink.findMany).toHaveBeenCalledWith(expect.objectContaining({
   where:expect.objectContaining({entityType:"MaintenanceRequest",entityId:"mr-1"}),take:26,
  }));
 });
 it("shows newest 25 and never claims full history when overflow exists",()=>{
  const events=Array.from({length:28},(_,i)=>({
   id:"m"+String(i),at:new Date(+day+i*1000),
   channel:"SMS" as const,direction:"OUTBOUND" as const,
   status:"Pending",href:null,source:"EXPLICIT_LINK" as const,
  }));
  const page=recentContextEvidence(events);
  expect(page.truncated).toBe(true);
  expect(page.entries).toHaveLength(25);
  expect(page.entries[0].id).toBe("m27");
 });
});
