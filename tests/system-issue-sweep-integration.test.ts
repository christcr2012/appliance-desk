import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { runAutomation } from "@/domains/automation/runs";
import { collectSystemIssueInputs, sweepSystemIssues } from "@/domains/system-issues/sources";

const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const enabled = process.env.CI === "true" && db.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(db.hostname);
const fresh = () => randomUUID().replaceAll("-", "");
const clock = new Date("2026-10-08T22:00:00Z");

describe.skipIf(!enabled)("S-1B source scanning and issue lifecycle on isolated PostgreSQL", () => {
  it("a paused task is never reported as stale, even with an old success", async () => {
    const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    const key = "test-old-" + fresh();
    const run = await prisma.automationRun.create({
      data: { ruleKey: "backup", runKey: key, state: "SUCCEEDED",
        environment: "test", startedAt: new Date("2026-08-01T12:00:00Z"),
        finishedAt: new Date("2026-08-01T12:01:00Z") },
    });
    try {
      await prisma.businessSettings.update({
        where: { id: "singleton" },
        data: { pausedAutomations: [...(Array.isArray(settings.pausedAutomations)
          ? settings.pausedAutomations.filter((v): v is string => typeof v === "string") : []), "backup"] },
      });
      const snapshot = await collectSystemIssueInputs(clock, { limit: 10 });
      expect(snapshot.issues.some((i) => i.kind === "AUTOMATION_STALE" && i.ruleKey === "backup")).toBe(false);
      expect(snapshot.clearFingerprints).toContain("automation-stale:backup");
    } finally {
      await prisma.businessSettings.update({where:{id:"singleton"},data:{
        pausedAutomations: settings.pausedAutomations === null ? [] : settings.pausedAutomations,
      }});
      await prisma.automationRun.delete({where:{id:run.id}});
    }
  });

  it("health sweep creates no duplicate customer/business exceptions or provider actions", async () => {
    const before = await Promise.all([
      prisma.providerOperation.count(), prisma.job.count(),
      prisma.invoice.count(), prisma.maintenanceRequest.count(),
    ]);
    await sweepSystemIssues(clock, 100);
    const after = await Promise.all([
      prisma.providerOperation.count(), prisma.job.count(),
      prisma.invoice.count(), prisma.maintenanceRequest.count(),
    ]);
    expect(after).toEqual(before);
  });

  it("never-run tasks stay distinguishable from stale tasks", async () => {
    const prior = await prisma.automationRun.findFirst({where:{ruleKey:"tax-rate-watch"}});
    if (prior) return; // other parallel integration fixtures may have exercised this rule
    const snapshot = await collectSystemIssueInputs(clock, {limit:10});
    expect(snapshot.issues.some((i) => i.kind === "AUTOMATION_STALE" && i.ruleKey === "tax-rate-watch")).toBe(false);
  });

  it("only an inspected page may clear a source fingerprint", async () => {
    const tag = fresh();
    const ids = ["zza-"+tag, "zzb-"+tag, "zzc-"+tag];
    for (const id of ids) {
      await prisma.officialSourceWatch.create({data:{
        id, label:"Synthetic official watch", url:"https://tax.colorado.gov/test-"+id,
        active:true, consecutiveFailures:0,
      }});
    }
    try {
      const page = await collectSystemIssueInputs(clock, {limit:1,cursor:"watch:"+ids[0]});
      expect(page.nextCursor).toBe("watch:"+ids[1]);
      expect(page.clearFingerprints).toContain("source-page:"+ids[1]);
      expect(page.clearFingerprints).not.toContain("source-page:"+ids[2]);
    } finally {
      await prisma.officialSourceWatch.deleteMany({where:{id:{in:ids}}});
    }
  });

  it("a failed automation records an issue and its next success resolves exactly that fingerprint", async () => {
    const first = new Date("2032-04-15T20:00:00Z");
    const second = new Date("2032-04-16T20:00:00Z");
    const key = "automation:backup";
    const fail = await runAutomation({ ruleKey:"backup", now:first,
      work:async()=>{throw new Error("synthetic timeout in test fixture");} });
    expect(fail.outcome).toBe("FAILED");
    const issue = await prisma.systemIssue.findUniqueOrThrow({where:{fingerprint:key}});
    expect(issue.kind).toBe("AUTOMATION_FAILED");
    expect(issue.detail).not.toContain("synthetic timeout");
    const success = await runAutomation({ ruleKey:"backup", now:second,
      work:async()=>({counts:{checked:1}}) });
    expect(success.outcome).toBe("RAN");
    const resolved = await prisma.systemIssue.findUniqueOrThrow({where:{fingerprint:key}});
    expect(resolved).toMatchObject({status:"RESOLVED",resolvedReason:"SOURCE_SUCCEEDED"});
    if (fail.runId) await prisma.automationRun.delete({where:{id:fail.runId}});
    if (success.runId) await prisma.automationRun.delete({where:{id:success.runId}});
    await prisma.systemIssue.delete({where:{fingerprint:key}});
  });

  it("multiple retries on one day do not simulate a multi-day source outage", async () => {
    const ids:string[]=[];
    try {
      for (let hour=17; hour<=19; hour++) {
        const row=await prisma.auditLog.create({data:{
          action:"tax.lookup_source_health",entityType:"TaxLookupSource",entityId:"colorado-gis",
          createdAt:new Date("2026-10-08T"+hour+":00:00Z"),
          newValue:{businessDate:"2026-10-08",outcome:"UNAVAILABLE"},
        }});
        ids.push(row.id);
      }
      const scan=await collectSystemIssueInputs(clock,{limit:50});
      expect(scan.issues.some((i)=>i.kind==="TAX_LOOKUP_UNAVAILABLE")).toBe(false);
    } finally {
      await prisma.auditLog.deleteMany({where:{id:{in:ids}}});
    }
  });

  it("requires three distinct dated lookup failures and clears on a real lookup success", async () => {
    const days = ["2026-10-06", "2026-10-07", "2026-10-08"];
    const ids:string[] = [];
    try {
      for (const day of days) {
        const item = await prisma.auditLog.create({data:{
          action:"tax.lookup_source_health",entityType:"TaxLookupSource",entityId:"colorado-gis",
          createdAt:new Date(day+"T20:00:00Z"),
          newValue:{businessDate:day,outcome:"UNAVAILABLE"},
        }});
        ids.push(item.id);
      }
      const failed = await collectSystemIssueInputs(clock,{limit:5});
      expect(failed.issues.some((i)=>i.kind==="TAX_LOOKUP_UNAVAILABLE" && i.count===3)).toBe(true);
      const ok = await prisma.auditLog.create({data:{
        action:"tax.lookup_source_health",entityType:"TaxLookupSource",entityId:"colorado-gis",
        createdAt:new Date("2026-10-08T21:00:00Z"),
        newValue:{businessDate:"2026-10-08",outcome:"AVAILABLE"},
      }});
      ids.push(ok.id);
      const recovered=await collectSystemIssueInputs(clock,{limit:5});
      expect(recovered.clearFingerprints).toContain("tax-lookup");
      expect(recovered.issues.some((i)=>i.kind==="TAX_LOOKUP_UNAVAILABLE")).toBe(false);
    } finally {
      await prisma.auditLog.deleteMany({where:{id:{in:ids}}});
    }
  });
});

describe.skipIf(!enabled)("S-1B durable provider and rate signals", () => {
  it("marks old provider uncertainty, then resolves it only after verified provider state", async () => {
    const tag = fresh();
    const operation = await prisma.providerOperation.create({data:{
      kind:"CUSTOMER_CREATE",subjectType:"Customer",subjectId:tag,
      idempotencyKey:"system-health-"+tag,status:"UNKNOWN",
      requestedAt:new Date("2026-10-01T18:00:00Z"),
    }});
    try {
      await sweepSystemIssues(clock,100);
      const first = await prisma.systemIssue.findUniqueOrThrow({where:{fingerprint:"provider-op:CUSTOMER_CREATE"}});
      expect(first.status).toBe("OPEN");
      expect(first.detail).not.toContain(tag);
      await prisma.providerOperation.update({where:{id:operation.id},data:{status:"SUCCEEDED"}});
      await sweepSystemIssues(clock,100);
      const final = await prisma.systemIssue.findUniqueOrThrow({where:{fingerprint:"provider-op:CUSTOMER_CREATE"}});
      expect(final.status).toBe("RESOLVED");
    } finally {
      await prisma.providerOperation.delete({where:{id:operation.id}});
    }
  });

  it("keeps customer recipients private while detecting unknown deliveries older than 48 hours", async () => {
    const tag=fresh(), privateRecipient="synthetic-"+tag+"@example.test";
    const item=await prisma.messageDelivery.create({data:{
      idempotencyKey:"system-unknown-"+tag,channel:"EMAIL",purpose:"TRANSACTIONAL",
      templateKey:"test",recipientType:"CUSTOMER",recipientAddress:privateRecipient,
      state:"UNKNOWN",requestedAt:new Date("2026-10-01T18:00:00Z"),
    }});
    try {
      const page=await collectSystemIssueInputs(clock,{limit:100});
      const issue=page.issues.find((i)=>i.kind==="MESSAGE_DELIVERY_UNKNOWN");
      expect(issue).toMatchObject({kind:"MESSAGE_DELIVERY_UNKNOWN"});
      await sweepSystemIssues(clock,100);
      const saved=await prisma.systemIssue.findUniqueOrThrow({where:{fingerprint:"message-unknown"}});
      expect(saved.detail).not.toContain(privateRecipient);
      await prisma.messageDelivery.update({where:{id:item.id},data:{state:"DELIVERED"}});
      const recovered=await collectSystemIssueInputs(clock,{limit:100});
      expect(recovered.clearFingerprints).toContain("message-unknown");
    } finally {
      await prisma.messageDelivery.delete({where:{id:item.id}});
    }
  });

  it("an applied rate decision clears only the matching rejected audit fingerprint", async () => {
    const tag=fresh();
    const evidence={jurisdictionId:"jur-"+tag,jurisdictionCode:"CO_TEST",
      effectiveFrom:"2026-11-01T00:00:00.000Z",observationId:"obs-"+tag,
      guardrailReasons:["DELTA_EXCEEDS_LIMIT"]};
    const failed=await prisma.auditLog.create({data:{
      action:"OFFICIAL_RATE_AUTO_APPLY_REJECTED",entityType:"TaxRateObservation",
      entityId:"obs-"+tag,newValue:evidence,createdAt:new Date("2026-10-06T20:00:00Z"),
    }});
    const ids=[failed.id];
    try {
      const snapshot=await collectSystemIssueInputs(clock,{limit:100});
      expect(snapshot.issues.some((i)=>i.kind==="TAX_RATE_GUARDRAIL" &&
        i.jurisdictionId===evidence.jurisdictionId)).toBe(true);
      const resolved=await prisma.auditLog.create({data:{
        action:"OFFICIAL_RATE_MANUAL_APPLIED",entityType:"TaxRateVersion",
        entityId:"version-"+tag,newValue:evidence,createdAt:new Date("2026-10-07T20:00:00Z"),
      }});
      ids.push(resolved.id);
      const later=await collectSystemIssueInputs(clock,{limit:100});
      expect(later.clearFingerprints).toContain("tax-rate:"+evidence.jurisdictionId+":2026-11-01");
      expect(later.issues.some((i)=>i.kind==="TAX_RATE_GUARDRAIL" &&
        i.jurisdictionId===evidence.jurisdictionId)).toBe(false);
    } finally {
      await prisma.auditLog.deleteMany({where:{id:{in:ids}}});
    }
  });
});
