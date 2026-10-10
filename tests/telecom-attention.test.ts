import { describe,expect,it,vi } from "vitest";
vi.mock("@/lib/prisma",()=>({prisma:{}}));
import { Prisma } from "@prisma/client";
import { telecomIssueScope,telecomSyncFinding,telecomStatementFinding } from "@/domains/messaging/telecom-attention";
import { renderSystemIssue } from "@/domains/system-issues/render";
import { metricDefinition } from "@/domains/reports/definitions";

const now=new Date("2026-10-10T12:00:00Z");
const scope=telecomIssueScope("a-private-account-001");
describe("COM-L13B telecom attention and evidence definitions",()=>{
  it("never flags disabled, never-synchronized, or recently recovered accounts",()=>{
    const base={scope,status:"READY" as const,now,lastSuccessAt:null,lastFailureAt:null};
    expect(telecomSyncFinding(base)).toBeNull();
    expect(telecomSyncFinding({...base,status:"DISABLED",lastSuccessAt:new Date("2026-10-01")})).toBeNull();
    expect(telecomSyncFinding({...base,lastSuccessAt:new Date("2026-10-10T10:00:00Z")})).toBeNull();
    const failed=telecomSyncFinding({...base,
      lastSuccessAt:new Date("2026-10-10T10:00:00Z"),
      lastFailureAt:new Date("2026-10-10T11:00:00Z")});
    expect(failed?.kind).toBe("TELECOM_SYNC_STALE");
  });
  it("creates stable PII-free high system issues that link to existing Today",()=>{
    const prior=new Date("2026-10-07T00:00:00Z");
    const issue=renderSystemIssue({
      kind:"TELECOM_SYNC_STALE",scope,lastSuccessAt:prior,
    });
    expect(issue.severity).toBe("HIGH");
    expect(issue.fingerprint).toBe("telecom-sync:"+scope);
    expect(issue.detail).not.toContain("a-private-account-001");
    const diff=renderSystemIssue({
      kind:"TELECOM_STATEMENT_DIFFERENCE",scope,period:"2026-09-01",
    });
    expect(diff).toMatchObject({
      severity:"HIGH",fingerprint:"telecom-statement:"+scope+":2026-09-01",
    });
    expect(()=>renderSystemIssue({
      kind:"TELECOM_STATEMENT_DIFFERENCE",scope,period:"private text",
    })).toThrow();
  });
  it("handles newest correction, credits, unknown and conflicting currencies",()=>{
    const original={price:new Prisma.Decimal("-1.00"),currency:"USD",
      providerAsOf:new Date("2026-10-05"),capturedAt:new Date("2026-10-05")};
    const corrected={...original,price:new Prisma.Decimal("-1.25"),
      providerAsOf:new Date("2026-10-08")};
    const base={scope,period:"2026-10-01",verifiedCents:-125,currency:"USD"};
    expect(telecomStatementFinding({...base,observations:[original,corrected]})).toBeNull();
    expect(telecomStatementFinding({...base,verifiedCents:-100,
      observations:[original,corrected]})?.kind).toBe("TELECOM_STATEMENT_DIFFERENCE");
    expect(telecomStatementFinding({...base,observations:[{...corrected,price:null}]})).toBeNull();
    expect(telecomStatementFinding({...base,observations:[{...corrected,currency:"EUR"}]})).toBeNull();
  });
  it("registers observed, unposted, estimate, budget and freshness with truthful bases",()=>{
    expect(metricDefinition("telecom.reportedSpend").kind).toBe("ACTUAL");
    expect(metricDefinition("telecom.reportedSpend").calculation).toMatch(/not invoice paid/);
    expect(metricDefinition("telecom.estimatedSpend").kind).toBe("ESTIMATE");
    expect(metricDefinition("telecom.reconciledSpend").calculation).toMatch(/not a payment/);
    expect(metricDefinition("telecom.budgetRemaining").kind).toBe("ESTIMATE");
    expect(metricDefinition("telecom.usageSyncAge").sources).toContain("TelecomSyncCursor");
  });
  it("keeps unresolved threads and unlinked missed-call counts private and actionable",()=>{
    const issue=renderSystemIssue({kind:"TELECOM_CONTACTS_UNRESOLVED",threadCount:3,unlinkedMissedCalls:1});
    expect(issue).toMatchObject({fingerprint:"telecom-unresolved",severity:"HIGH"});
    expect(issue.summary).not.toMatch(/phone|customer name/i);
    expect(()=>renderSystemIssue({kind:"TELECOM_CONTACTS_UNRESOLVED",threadCount:0,unlinkedMissedCalls:0})).toThrow();
  });
});
