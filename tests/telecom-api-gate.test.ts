import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSession = vi.fn();
const enrollmentRequired = vi.fn();
const upload = vi.fn();
const verify = vi.fn();
const read = vi.fn();
vi.mock("@/lib/session",()=>({getServerSession:(...args:unknown[])=>getServerSession(...args)}));
vi.mock("@/domains/security/two-factor",()=>({
  twoFactorEnrollmentRequired:(...args:unknown[])=>enrollmentRequired(...args),
}));
vi.mock("@/domains/messaging/telecom-statements",()=>({
  uploadTelecomStatement:(...args:unknown[])=>upload(...args),
  verifyTelecomStatement:(...args:unknown[])=>verify(...args),
  productionStatementStore:{read:(...args:unknown[])=>read(...args)},
  parseTelecomStatementDollars:vi.fn(),
}));
vi.mock("@/domains/messaging/communications-policy",()=>({
  communicationsPolicySchema:{safeParse:vi.fn(),parse:vi.fn()},
  saveCommunicationsPolicy:vi.fn(),
}));
vi.mock("@/lib/prisma",()=>({prisma:{
  telecomStatement:{findUnique:vi.fn()},
  businessSettings:{findUnique:vi.fn()},
  $transaction:vi.fn(),
}}));
vi.mock("@/lib/team-actor",()=>({assertActiveTeamActor:vi.fn()}));

import { POST, GET } from "@/app/api/desk/telecom/route";

describe("COM-L13A telecom API enrollment and role gate",()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    getServerSession.mockResolvedValue({
      user:{id:"owner-test",role:"OWNER",archivedAt:null},
    });
    enrollmentRequired.mockResolvedValue(true);
  });
  it("rejects a signed-in but not enrolled owner on upload or verification",async()=>{
    const request = new Request("https://example.test/api/desk/telecom",{
      method:"POST",headers:{origin:"https://example.test","content-type":"application/json"},
      body:JSON.stringify({kind:"verify",statementId:"test",hash:"a".repeat(64)}),
    });
    expect((await POST(request)).status).toBe(403);
    expect(verify).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(enrollmentRequired).toHaveBeenCalledWith("owner-test","OWNER");
  });
  it("rejects the same unenrolled account's direct private PDF GET",async()=>{
    const res=await GET(new Request("https://example.test/api/desk/telecom?statement=private-statement-1"));
    expect(res.status).toBe(403);
    expect(read).not.toHaveBeenCalled();
  });
  it("requires exact same-origin POST with no cross-origin bypass",async()=>{
    enrollmentRequired.mockResolvedValue(false);
    const request=new Request("https://example.test/api/desk/telecom",{
      method:"POST",headers:{origin:"https://other.example.test","content-type":"application/json"},
      body:JSON.stringify({kind:"verify"}),
    });
    expect((await POST(request)).status).toBe(403);
    expect(verify).not.toHaveBeenCalled();
  });
  it("denies staff access even after completed enrollment",async()=>{
    enrollmentRequired.mockResolvedValue(false);
    getServerSession.mockResolvedValue({user:{id:"staff",role:"STAFF",archivedAt:null}});
    expect((await GET(new Request("https://example.test/api/desk/telecom?statement=some-record"))).status).toBe(404);
  });
});
