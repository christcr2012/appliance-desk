import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getTelecomSpend } from "@/domains/messaging/telecom-costs-store";
import { RECOMMENDED_TELECOM_ALERT_RULES } from "@/domains/messaging/telecom-alerts";
import { communicationsPolicySchema } from "@/domains/messaging/communications-policy";

const database = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const enabled = process.env.CI==="true" &&
  ["127.0.0.1","localhost"].includes(database.hostname) &&
  database.pathname==="/appliance_desk_test";
const token=randomUUID().replaceAll("-","").slice(0,16);
const acct="l12-account-"+token;
const owner="l12-owner-"+token, staff="l12-staff-"+token;
const start=new Date("2026-10-01T00:00:00Z");
const end=new Date("2026-10-02T00:00:00Z");
const now=new Date("2026-10-09T12:00:00Z");
const tolerance={absoluteCents:0,percentBasisPoints:null,combination:"ANY" as const};
describe.skipIf(!enabled)("COM-L12 verified cost periods and role gates (real Postgres)",()=>{
  beforeAll(async()=>{
    await prisma.user.createMany({data:[
      {id:owner,email:owner+"@example.test",role:"OWNER"},
      {id:staff,email:staff+"@example.test",role:"STAFF"},
    ]});
    await prisma.telecomAccount.create({data:{
      id:acct,provider:"twilio",environment:"TEST",
      externalAccountId:"AC"+"d".repeat(32),label:"COM-L12 isolated",
    }});
    await prisma.telecomUsageSnapshot.createMany({data:[
      {accountId:acct,category:"totalprice",startDate:start,endDate:end,
        count:"1",countUnit:"messages",usage:"1",usageUnit:"unit",
        price:"0.1000000000",currency:"USD",
        providerAsOf:now,payloadHash:"a".repeat(64),providerSource:"test",isTotal:true},
      {accountId:acct,category:"sms-outbound",startDate:start,endDate:end,
        count:"1",countUnit:"messages",usage:"1",usageUnit:"unit",
        price:"0.0400000000",currency:"USD",
        providerAsOf:now,payloadHash:"b".repeat(64),providerSource:"test"},
      // A matching-day total must not be added to the exact two-day total.
      {accountId:acct,category:"totalprice",startDate:start,endDate:start,
        count:"1",countUnit:"messages",usage:"1",usageUnit:"unit",
        price:"0.0800000000",currency:"USD",
        providerAsOf:now,payloadHash:"c".repeat(64),providerSource:"test",isTotal:true},
    ]});
    const old=await prisma.communicationCostFact.create({data:{
      accountId:acct,sourceKey:"l12-original-"+token,component:"message",
      classification:"PROVIDER_REPORTED",amount:"0.0100000000",
      currency:"USD",occurredAt:new Date("2026-10-01T10:00:00Z"),
    }});
    await prisma.communicationCostFact.create({data:{
      accountId:acct,sourceKey:"l12-revised-"+token,component:"message",
      classification:"PROVIDER_REPORTED",amount:"0.0200000000",
      currency:"USD",occurredAt:new Date("2026-10-01T10:00:00Z"),supersedesId:old.id,
    }});
    await prisma.telecomSyncCursor.create({data:{
      accountId:acct,resource:"USAGE",windowStart:start,
      windowEnd:new Date("2026-10-03T00:00:00Z"),lastSuccessAt:now,
      completedThrough:new Date("2026-10-03T00:00:00Z"),
    }});
    await prisma.telecomStatement.create({data:{
      accountId:acct,externalId:"l12-invoice-"+token,
      periodStart:start,periodEnd:end,currency:"USD",invoiceTotalCents:11,
      issueDate:new Date("2026-10-06T00:00:00Z"),
      privateEvidenceStorageKey:"telecom-statements/l12/fixture.pdf",
      evidenceHash:"a".repeat(64),state:"VERIFIED",
      verifiedByUserId:owner,verifiedAt:now,
    }});
  });
  afterAll(async()=>{
    await prisma.communicationCostFact.deleteMany({where:{accountId:acct}});
    await prisma.telecomStatement.deleteMany({where:{accountId:acct}});
    await prisma.telecomUsageSnapshot.deleteMany({where:{accountId:acct}});
    await prisma.telecomSyncCursor.deleteMany({where:{accountId:acct}});
    await prisma.telecomAccount.deleteMany({where:{id:acct}});
    await prisma.user.deleteMany({where:{id:{in:[owner,staff]}}});
  });

  it("keeps GMT total, current resource charges and verified invoice separate",async()=>{
    const v=await getTelecomSpend({accountId:acct,actorUserId:owner,
      periodStart:start,periodEnd:end,now,tolerance,
      alertRules:RECOMMENDED_TELECOM_ALERT_RULES});
    expect(v.usage.accountTotalCents).toBe(10);
    expect(v.usage.coverage).toBe("EXACT_GMT_PERIOD");
    expect(v.usage.breakdownCents).toMatchObject({"sms-outbound":4});
    expect(v.usage.residualCents).toBe(6);
    expect(v.resources.providerReportedCents).toBe(2);
    expect(v.resources.providerUnallocatedCents).toBe(2);
    expect(v.statement).toMatchObject({state:"VERIFIED",invoiceTotalCents:11});
    expect(v.reconciliation).toMatchObject({differenceCents:-1,mismatch:true});
    expect(v.bookedExpenseCents).toBeNull();
    expect(v.alertPreview?.activation).toBe("OFF");
    expect(v.alertPreview?.candidates).toContain("INVOICE_DIFFERENCE");
  });

  it("rejects a staff request for company finances at the query boundary",async()=>{
    await expect(getTelecomSpend({accountId:acct,actorUserId:staff,
      periodStart:start,periodEnd:end,now,tolerance})).rejects.toThrow("no longer has access");
  });

  it("refuses a partial provider interval instead of substituting resource costs",async()=>{
    const v=await getTelecomSpend({accountId:acct,actorUserId:owner,
      periodStart:start,periodEnd:new Date("2026-10-03T00:00:00Z"),
      now,tolerance});
    expect(v.usage.complete).toBe(false);
    expect(v.usage.accountTotalCents).toBeNull();
    expect(v.resources.providerReportedCents).toBe(2);
    expect(v.reconciliation.mismatch).toBeNull();
    expect(v.statement.state).toBe("MISSING");
  });

  it("never selects an arbitrary one of two VERIFIED provider invoices",async()=>{
    const extra=await prisma.telecomStatement.create({data:{
      accountId:acct,externalId:"l12-extra-"+token,periodStart:start,periodEnd:end,
      currency:"USD",invoiceTotalCents:50,
      issueDate:new Date("2026-10-06T00:00:00Z"),
      privateEvidenceStorageKey:"telecom-statements/l12/duplicate.pdf",
      evidenceHash:"b".repeat(64),state:"VERIFIED",
      verifiedByUserId:owner,verifiedAt:now,
    }});
    try{
      const v=await getTelecomSpend({accountId:acct,actorUserId:owner,
        periodStart:start,periodEnd:end,now,tolerance});
      expect(v.statement.state).toBe("AMBIGUOUS");
      expect(v.reconciliation.statementCents).toBeNull();
      expect(v.reconciliation.mismatch).toBeNull();
    }finally{
      await prisma.telecomStatement.delete({where:{id:extra.id}});
    }
  });

  it("offers owner-configurable cost thresholds without turning on SMS or alerts",()=>{
    const proposal=communicationsPolicySchema.parse({
      schemaVersion:1,manualSmsEnabled:false,primaryAccountId:acct,
      primaryNumberId:"l12-number",approvedPolicyVersion:1,maxSegments:3,
      supportedCountries:["US"],telecomCostAlerts:{...RECOMMENDED_TELECOM_ALERT_RULES},
    });
    expect(proposal.manualSmsEnabled).toBe(false);
    expect(proposal.telecomCostAlerts?.enabled).toBe(false);
    expect(communicationsPolicySchema.safeParse({
      ...proposal,telecomCostAlerts:{...RECOMMENDED_TELECOM_ALERT_RULES,
        monthlyBudgetCents:10000,elevatedCents:7500},
    }).success).toBe(false);
  });
});
