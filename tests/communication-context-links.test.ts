import {beforeEach,describe,expect,it,vi} from "vitest";
const tx=vi.hoisted(()=>({
 communicationMessage:{findFirst:vi.fn()},
 job:{findFirst:vi.fn(),findMany:vi.fn()},
 maintenanceRequest:{findFirst:vi.fn(),findMany:vi.fn()},
 invoice:{findFirst:vi.fn(),findMany:vi.fn()},
 communicationLink:{upsert:vi.fn()},
 auditLog:{create:vi.fn()},
}));
const guard=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/prisma",()=>({prisma:{
 $transaction:(fn:(client:typeof tx)=>unknown)=>fn(tx),
 job:tx.job,maintenanceRequest:tx.maintenanceRequest,invoice:tx.invoice,
}}));
vi.mock("@/lib/session",()=>({requireRole:guard}));
import {linkMessageContext,getContextLinkChoices} from "@/domains/messaging/context-links";
beforeEach(()=>{
 vi.clearAllMocks();
 guard.mockResolvedValue({user:{id:"owner-1",role:"OWNER"}});
 tx.communicationMessage.findFirst.mockResolvedValue({thread:{customerId:"c1"}});
 tx.job.findFirst.mockResolvedValue({id:"j1"});
 tx.communicationLink.upsert.mockResolvedValue({});
 tx.auditLog.create.mockResolvedValue({});
});
describe("manual verified context association",()=>{
 it("rejects unresolved identity before writing a link",async()=>{
  tx.communicationMessage.findFirst.mockResolvedValue(null);
  await expect(linkMessageContext({
   threadId:"t1",messageId:"m1",kind:"Job",entityId:"j1",
  })).rejects.toThrow(/confirmed customer/);
  expect(tx.communicationLink.upsert).not.toHaveBeenCalled();
 });
 it("refuses a record belonging to someone else",async()=>{
  tx.job.findFirst.mockResolvedValue(null);
  await expect(linkMessageContext({
   threadId:"t1",messageId:"m1",kind:"Job",entityId:"other",
  })).rejects.toThrow(/does not belong/);
  expect(tx.job.findFirst).toHaveBeenCalledWith({
   where:{id:"other",customerId:"c1"},select:{id:true},
  });
  expect(tx.auditLog.create).not.toHaveBeenCalled();
 });
 it("records a unique explicit link and audit only for the same customer",async()=>{
  await linkMessageContext({threadId:"t1",messageId:"m1",kind:"Job",entityId:"j1"});
  expect(tx.communicationMessage.findFirst).toHaveBeenCalledWith(
   expect.objectContaining({where:expect.objectContaining({
    id:"m1",threadId:"t1",
    thread:{resolution:"RESOLVED",customerId:{not:null}},
   })}));
  expect(tx.communicationLink.upsert).toHaveBeenCalledWith(
   expect.objectContaining({create:expect.objectContaining({
    entityType:"Job",entityId:"j1",source:"EXPLICIT",actorUserId:"owner-1",
   })}));
  expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
 });
});
