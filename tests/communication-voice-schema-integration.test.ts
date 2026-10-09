import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getPrivateCallMetadata, listMediaRetentionReview } from "@/domains/messaging/voice-media";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const isolated = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";
const id = "voice-l7-fixture";
describe.skipIf(!isolated)("COM-L7 private call/media constraints (disposable PostgreSQL)", () => {
  it("checks private access, provider replay, held media and retention", async () => {
    const actor = "voice-l7-owner", staff = "voice-l7-staff",
      unrelated = "voice-l7-other", customer = "voice-l7-customer";
    const account = "voice-l7-account", number = "voice-l7-number";
    const cp = "voice-l7-contact", thread = "voice-l7-thread";
    const deadline = new Date(Date.now() + 2 * 86400000);
    const now = new Date(deadline.getTime() + 86400000);
    await prisma.user.createMany({data:[
      {id:actor,role:"OWNER",email:actor+"@example.test"},
      {id:staff,role:"STAFF",email:staff+"@example.test"},
      {id:unrelated,role:"STAFF",email:unrelated+"@example.test"},
      {id:customer,role:"CUSTOMER",email:customer+"@example.test"}
    ]});
    try {
      await prisma.telecomAccount.create({data:{
        id:account,label:id,provider:"twilio",environment:"TEST",externalAccountId:id,status:"READY"
      }});
      await prisma.businessPhoneNumber.create({data:{
        id:number,accountId:account,address:"+13035550187",providerNumberId:id
      }});
      await prisma.contactPoint.create({data:{
        id:cp,environment:"TEST",channel:"SMS",address:"+13035550186"
      }});
      await prisma.communicationThread.create({data:{
        id:thread,accountId:account,businessNumberId:number,externalContactPointId:cp,assignedUserId:staff
      }});
      await prisma.callSession.create({data:{
        id,accountId:account,businessNumberId:number,threadId:thread,
        direction:"INBOUND",providerRootCallId:id,state:"ENDED",outcome:"VOICEMAIL"
      }});
      await prisma.callLeg.create({data:{
        accountId:account,callSessionId:id,providerCallId:id,role:"INBOUND",status:"COMPLETED"
      }});
      await prisma.communicationMedia.create({data:{
        id:id+"-media",callSessionId:id,kind:"VOICEMAIL",providerResourceId:id,
        privateStorageKey:"private/calls/"+id,contentHash:"a".repeat(64),
        state:"AVAILABLE",retentionUntil:deadline
      }});
      await prisma.communicationMedia.create({data:{
        id:id+"-hold",callSessionId:id,kind:"RECORDING",providerResourceId:id+"-hold",
        privateStorageKey:"private/calls/"+id+"-hold",contentHash:"b".repeat(64),
        state:"AVAILABLE",retentionUntil:deadline,legalHold:true
      }});
      const visible = await getPrivateCallMetadata(staff,id);
      expect((await getPrivateCallMetadata(actor,id)).id).toBe(id);
      await expect(getPrivateCallMetadata(unrelated,id)).rejects.toThrow();
      await expect(getPrivateCallMetadata(customer,id)).rejects.toThrow();
      expect(visible.media).toHaveLength(2);
      expect(JSON.stringify(visible)).not.toContain("private/calls/");
      expect((await listMediaRetentionReview(actor,now)).map(r=>r.id)).toContain(id+"-media");
      expect((await listMediaRetentionReview(actor,now)).map(r=>r.id)).not.toContain(id+"-hold");
      await expect(listMediaRetentionReview(staff,now)).rejects.toThrow();
      await expect(prisma.communicationMedia.delete({where:{id:id+"-hold"}})).rejects.toThrow();
      await expect(prisma.communicationMedia.create({data:{
        callSessionId:id,kind:"TRANSCRIPT",providerResourceId:id+"-unsafe",
        privateStorageKey:"https://media.example.test/recording",contentHash:"c".repeat(64),
        state:"AVAILABLE"
      }})).rejects.toThrow();
      await expect(prisma.callSession.create({data:{
        accountId:account,businessNumberId:number,direction:"INBOUND",providerRootCallId:id
      }})).rejects.toThrow();
      await expect(prisma.callLeg.create({data:{
        accountId:account,callSessionId:id,providerCallId:id+"-negative",role:"FORWARD",
        durationSeconds:-1
      }})).rejects.toThrow();
      await expect(prisma.callLeg.create({data:{
        accountId:account,callSessionId:id,providerCallId:id,role:"FORWARD"
      }})).rejects.toThrow();
    } finally {
      await prisma.communicationMedia.updateMany({where:{callSessionId:id},data:{legalHold:false}});
      await prisma.communicationMedia.deleteMany({where:{callSessionId:id}});
      await prisma.callLeg.deleteMany({where:{callSessionId:id}});
      await prisma.callSession.deleteMany({where:{id}});
      await prisma.communicationThread.deleteMany({where:{id:thread}});
      await prisma.contactPoint.deleteMany({where:{id:cp}});
      await prisma.businessPhoneNumber.deleteMany({where:{id:number}});
      await prisma.telecomAccount.deleteMany({where:{id:account}});
      await prisma.user.deleteMany({where:{id:{in:[actor,staff,unrelated,customer]}}});
    }
  });
});
