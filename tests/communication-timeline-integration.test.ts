import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,describe,expect,it,vi } from "vitest";
vi.mock("@/lib/session",()=>({requireRole:vi.fn().mockResolvedValue({user:{role:"OWNER"}})}));
import { prisma } from "@/lib/prisma";
import { getLinkedCommunicationRows } from "@/domains/messaging/context-timeline";
import { confirmedVoiceThread,linkEarlierConfirmedCalls } from "@/domains/messaging/voice-thread-link";
import { mergeTimelinePage,readTimelineCursor } from "@/domains/customers/timeline-page";

const u=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true" && ["localhost","127.0.0.1"].includes(u.hostname) &&
  u.pathname==="/appliance_desk_test";
const suffix=randomUUID().replaceAll("-","").slice(0,13);
const accountId="l14a-acct-"+suffix, numberId="l14a-number-"+suffix;
const customerId="l14a-customer-"+suffix, userId="l14a-user-"+suffix;
const leadId="l14a-lead-"+suffix, anotherLeadId="l14a-other-"+suffix;
const no="+1"+(BigInt("0x"+suffix)%BigInt(10000000000)).toString().padStart(10,"0");
const otherNo="+1"+(BigInt("0x"+suffix)+BigInt(1)).toString().slice(-10).padStart(10,"0");
const thirdNo="+1"+(BigInt("0x"+suffix)+BigInt(2)).toString().slice(-10).padStart(10,"0");
const stamp=new Date("2026-10-10T12:15:00Z");
let custThread="",leadThread="",otherThread="";
let pointIds:string[]=[];
describe.skipIf(!enabled)("COM-L14A exact confirmed context and cursor (real Postgres)",()=>{
  beforeAll(async()=>{
    await prisma.user.create({data:{
      id:userId,email:"l14a-"+suffix+"@example.test",role:"CUSTOMER",
    }});
    await prisma.customer.create({data:{id:customerId,userId,
      referralCode:"L14A"+suffix.toUpperCase()}});
    await prisma.lead.createMany({data:[
      {id:leadId,contactName:"Lead A",phone:no},
      {id:anotherLeadId,contactName:"Lead B",phone:otherNo},
    ]});
    await prisma.telecomAccount.create({data:{
      id:accountId,provider:"twilio",environment:"TEST",label:"L14A isolated",
      externalAccountId:"AC"+"9".repeat(32),
    }});
    await prisma.businessPhoneNumber.create({data:{id:numberId,accountId,
      address:"+15555559999",providerNumberId:"PN"+suffix}});
    const points=await Promise.all([no,otherNo,thirdNo].map(address=>
      prisma.contactPoint.create({data:{environment:"TEST",channel:"SMS",address}})));
    pointIds=points.map(p=>p.id);
    const rows=await Promise.all([
      prisma.communicationThread.create({data:{
        accountId,businessNumberId:numberId,externalContactPointId:points[0].id,
        customerId,resolution:"RESOLVED",
      }}),
      prisma.communicationThread.create({data:{
        accountId,businessNumberId:numberId,externalContactPointId:points[1].id,
        leadId,resolution:"RESOLVED",
      }}),
      prisma.communicationThread.create({data:{
        accountId,businessNumberId:numberId,externalContactPointId:points[2].id,
        leadId:anotherLeadId,resolution:"UNRESOLVED",
      }}),
    ]);
    [custThread,leadThread,otherThread]=rows.map(x=>x.id);
    for(const [i,threadId] of [custThread,leadThread,otherThread].entries()) {
      await prisma.communicationMessage.create({data:{
        accountId,threadId,direction:"INBOUND",bodyHash:(i+1).toString().repeat(64),
        occurredAt:stamp,redactedAt:stamp,
      }});
      await prisma.callSession.create({data:{
        accountId,businessNumberId:numberId,threadId:null,contactPointId:pointIds[i],
        direction:"INBOUND",providerRootCallId:"CA"+suffix+i,startedAt:stamp,
        outcome:"MISSED",state:"ENDED",
      }});
    }
  });
  afterAll(async()=>{
    await prisma.callSession.deleteMany({where:{accountId}});
    await prisma.communicationMessage.deleteMany({where:{accountId}});
    await prisma.communicationThread.deleteMany({where:{accountId}});
    await prisma.contactPoint.deleteMany({where:{address:{in:[no,otherNo,thirdNo]},environment:"TEST"}});
    await prisma.businessPhoneNumber.deleteMany({where:{id:numberId}});
    await prisma.telecomAccount.deleteMany({where:{id:accountId}});
    await prisma.lead.deleteMany({where:{id:{in:[leadId,anotherLeadId]}}});
    await prisma.customer.deleteMany({where:{id:customerId}});
    await prisma.user.deleteMany({where:{id:userId}});
  });
  it("never includes an unrelated or unresolved thread, even with the same timestamps",async()=>{
    const unlinked=await getLinkedCommunicationRows("Customer",customerId,null);
    expect(unlinked.calls).toHaveLength(0);
    const counts=await prisma.$transaction(async tx=>{
      const customerKey={accountId,businessNumberId:numberId,contactPointId:pointIds[0]};
      const leadKey={accountId,businessNumberId:numberId,contactPointId:pointIds[1]};
      const otherKey={accountId,businessNumberId:numberId,contactPointId:pointIds[2]};
      expect(await confirmedVoiceThread(tx,customerKey)).toBe(custThread);
      expect(await confirmedVoiceThread(tx,otherKey)).toBeNull();
      return [
        await linkEarlierConfirmedCalls(tx,customerKey,custThread),
        await linkEarlierConfirmedCalls(tx,leadKey,leadThread),
        await linkEarlierConfirmedCalls(tx,otherKey,otherThread),
      ];
    });
    expect(counts).toEqual([1,1,0]);
    const cust=await getLinkedCommunicationRows("Customer",customerId,null);
    const lead=await getLinkedCommunicationRows("Lead",leadId,null);
    const other=await getLinkedCommunicationRows("Lead",anotherLeadId,null);
    expect(cust.messages).toHaveLength(1);
    expect(cust.calls).toHaveLength(1);
    expect(lead.messages).toHaveLength(1);
    expect(lead.calls).toHaveLength(1);
    expect(other.messages).toHaveLength(0);
    expect(other.calls).toHaveLength(0);
    expect(cust.messages[0].href).toContain(custThread);
    expect(lead.messages[0].href).toContain(leadThread);
    expect(JSON.stringify(cust)).not.toContain(leadThread);
    expect(JSON.stringify(cust)).not.toContain(otherThread);
    expect(JSON.stringify(lead)).not.toContain(custThread);
    expect(cust.calls[0].summary).toBe("Missed incoming call");
    expect(cust.messages[0].detail).not.toMatch(/Lead A|Lead B|bodyHash/);
  });
  it("applies stable equal-time cursor to real linked message and call source records",async()=>{
    const first=await getLinkedCommunicationRows("Customer",customerId,null);
    const page=mergeTimelinePage([],[],first.messages,first.calls);
    expect(page.entries.map(x=>x.kind)).toEqual(["message","call"]);
    const cursor=Buffer.from(JSON.stringify({
      kind:"message",id:first.messages[0].id.slice(8),
      createdAt:stamp.toISOString(),
    })).toString("base64url");
    const more=await getLinkedCommunicationRows("Customer",customerId,readTimelineCursor(cursor));
    expect(more.messages).toHaveLength(0);
    expect(more.calls).toHaveLength(1);
  });
});
