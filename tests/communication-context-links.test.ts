import {beforeEach,describe,expect,it,vi} from "vitest";
const tx=vi.hoisted(()=>({
 communicationMessage:{findFirst:vi.fn()},
 job:{findFirst:vi.fn(),findMany:vi.fn()},
 maintenanceRequest:{findFirst:vi.fn(),findMany:vi.fn()},
 invoice:{findFirst:vi.fn(),findMany:vi.fn()},
 communicationLink:{createMany:vi.fn()},
 auditLog:{create:vi.fn()},
}));
const guard=vi.hoisted(()=>vi.fn());
const activeGuard=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/prisma",()=>({prisma:{
 $transaction:(fn:(client:typeof tx)=>unknown)=>fn(tx),
 job:tx.job,maintenanceRequest:tx.maintenanceRequest,invoice:tx.invoice,
}}));
vi.mock("@/lib/session",()=>({requireRole:guard}));
vi.mock("@/lib/team-actor",()=>({assertActiveTeamActor:activeGuard}));
import {linkMessageContext,getContextLinkChoices} from "@/domains/messaging/context-links";
beforeEach(()=>{
 vi.clearAllMocks();
 guard.mockResolvedValue({user:{id:"owner-1",role:"OWNER"}});
 activeGuard.mockResolvedValue({id:"owner-1",role:"OWNER"});
 tx.communicationMessage.findFirst.mockResolvedValue({thread:{customerId:"c1"}});
 tx.job.findFirst.mockResolvedValue({id:"j1"});
 tx.communicationLink.createMany.mockResolvedValue({count:1});
 tx.auditLog.create.mockResolvedValue({count:1});
});
describe("manual verified context association",()=>{
 it("rejects unresolved identity before writing a link",async()=>{
  tx.communicationMessage.findFirst.mockResolvedValue(null);
  await expect(linkMessageContext({
   threadId:"t1",messageId:"m1",kind:"Job",entityId:"j1",
  })).rejects.toThrow(/confirmed customer/);
  expect(tx.communicationLink.createMany).not.toHaveBeenCalled();
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
  expect(tx.communicationLink.createMany).toHaveBeenCalledWith(
   expect.objectContaining({data:expect.arrayContaining([expect.objectContaining({
    entityType:"Job",entityId:"j1",source:"EXPLICIT",actorUserId:"owner-1",
   })])}));
  expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
 });
 it("does not produce a second audit event on replay",async()=>{
  tx.communicationLink.createMany.mockResolvedValue({count:0});
  await linkMessageContext({threadId:"t1",messageId:"m1",kind:"Job",entityId:"j1"});
  expect(tx.auditLog.create).not.toHaveBeenCalled();
 });
 it("rejects a deactivated actor before mutating any context",async()=>{
  activeGuard.mockRejectedValue(new Error("This account no longer has access"));
  await expect(linkMessageContext({
    threadId:"t1",messageId:"m1",kind:"Job",entityId:"j1",
  })).rejects.toThrow(/no longer has access/);
  expect(tx.communicationMessage.findFirst).not.toHaveBeenCalled();
  expect(tx.communicationLink.createMany).not.toHaveBeenCalled();
 });
 it("distinguishes same-type jobs and same-status maintenance records",async()=>{
  tx.job.findMany.mockResolvedValue([
   {id:"job-alpha",type:"DELIVERY",scheduledAt:new Date("2026-10-11")},
   {id:"job-bravo",type:"DELIVERY",scheduledAt:new Date("2026-10-12")},
  ]);
  tx.maintenanceRequest.findMany.mockResolvedValue([
   {id:"request-one",status:"SUBMITTED",openedAt:new Date("2026-10-10")},
   {id:"request-two",status:"SUBMITTED",openedAt:new Date("2026-10-09")},
  ]);
  tx.invoice.findMany.mockResolvedValue([]);
  const labels=(await getContextLinkChoices("c1")).map(x=>x.label);
  expect(new Set(labels).size).toBe(4);
  expect(labels[0]).toContain("2026-10-11");
  expect(labels[2]).toContain("2026-10-10");
 });
});
