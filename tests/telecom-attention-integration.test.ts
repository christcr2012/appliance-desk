import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,describe,expect,it} from "vitest";
import {prisma} from "@/lib/prisma";
import {collectTelecomAttention} from "@/domains/messaging/telecom-health";

const url=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true" && ["localhost","127.0.0.1"].includes(url.hostname) &&
  url.pathname==="/appliance_desk_test";
const suffix=randomUUID().replaceAll("-","").slice(0,12);
const accountId="l13b-account-"+suffix,ownerId="l13b-owner-"+suffix;
const now=new Date("2026-10-10T12:00:00Z");
const start=new Date("2026-09-01T00:00:00Z");
const end=new Date("2026-09-30T00:00:00Z");
describe.skipIf(!enabled)("COM-L13B telecom S sweep (disposable PostgreSQL)",()=>{
  beforeAll(async()=>{
    await prisma.user.create({data:{id:ownerId,email:"l13b-"+suffix+"@example.test",role:"OWNER"}});
    await prisma.telecomAccount.create({data:{
      id:accountId,provider:"twilio",environment:"TEST",
      externalAccountId:"AC"+"f".repeat(32),label:"L13B synthetic",status:"READY",
    }});
    await prisma.telecomSyncCursor.create({data:{
      accountId,resource:"USAGE",windowStart:start,windowEnd:new Date("2026-10-01T00:00:00Z"),
      lastSuccessAt:new Date("2026-10-07T11:00:00Z"),
    }});
    await prisma.telecomUsageSnapshot.create({data:{
      accountId,category:"totalprice",isTotal:true,startDate:start,endDate:end,
      count:"1",countUnit:"bill",usage:"1",usageUnit:"period",
      price:"0.1000000000",currency:"USD",providerAsOf:new Date("2026-10-07"),
      providerSource:"synthetic",payloadHash:"1".repeat(64),
    }});
    await prisma.telecomStatement.create({data:{
      accountId,externalId:"l13b-"+suffix,revision:1,periodStart:start,periodEnd:end,
      currency:"USD",invoiceTotalCents:11,issueDate:new Date("2026-10-02"),
      privateEvidenceStorageKey:"telecom-statements/"+accountId+"/fixture.pdf",
      evidenceHash:"a".repeat(64),state:"VERIFIED",verifiedByUserId:ownerId,verifiedAt:now,
    }});
  });
  afterAll(async()=>{
    await prisma.telecomStatement.deleteMany({where:{accountId}});
    await prisma.telecomUsageSnapshot.deleteMany({where:{accountId}});
    await prisma.telecomSyncCursor.deleteMany({where:{accountId}});
    await prisma.telecomAccount.deleteMany({where:{id:accountId}});
    await prisma.user.deleteMany({where:{id:ownerId}});
  });
  it("creates typed privacy-safe stale and verified mismatch issues and clears after provider recovery",async()=>{
    const first=await collectTelecomAttention(now);
    expect(first.issues.filter(x=>x.kind==="TELECOM_SYNC_STALE")).toHaveLength(1);
    expect(first.issues.filter(x=>x.kind==="TELECOM_STATEMENT_DIFFERENCE")).toHaveLength(1);
    expect(JSON.stringify(first)).not.toContain(accountId);
    await prisma.telecomSyncCursor.update({where:{
      accountId_resource:{accountId,resource:"USAGE"},
    },data:{lastSuccessAt:new Date("2026-10-10T11:30:00Z"),lastFailureAt:null}});
    await prisma.telecomUsageSnapshot.create({data:{
      accountId,category:"totalprice",isTotal:true,startDate:start,endDate:end,
      count:"1",countUnit:"bill",usage:"1",usageUnit:"period",
      price:"0.1100000000",currency:"USD",providerAsOf:new Date("2026-10-10"),
      providerSource:"synthetic",payloadHash:"2".repeat(64),
    }});
    const recovered=await collectTelecomAttention(now);
    expect(recovered.issues).toHaveLength(0);
    expect(recovered.cleared).toEqual(expect.arrayContaining([
      expect.stringMatching(/^telecom-sync:/),
      expect.stringMatching(/^telecom-statement:/),
    ]));
  });
});
