import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { uploadTelecomStatement, verifyTelecomStatement,
  type PrivateTelecomStatementStore } from "@/domains/messaging/telecom-statements";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const enabled = process.env.CI === "true" &&
  ["localhost","127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";
const suffix = randomUUID().replaceAll("-", "").slice(0,14);
const accountId = "l13a-account-" + suffix;
const ownerId = "l13a-owner-" + suffix;
const staffId = "l13a-staff-" + suffix;
const bytes = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");
const stored = new Map<string, Uint8Array>();
const store: PrivateTelecomStatementStore = {
  async put(key, value) { stored.set(key, Buffer.from(value)); },
  async read(key) { return stored.get(key) ?? null; },
};
const base = {
  accountId, actorUserId:ownerId, externalId:"October-2026",
  periodStart:"2026-10-01",periodEnd:"2026-10-31",
  issueDate:"2026-11-03", invoiceTotalCents:1755,
  currency:"USD", bytes,
};
describe.skipIf(!enabled)("COM-L13A verified private statement evidence",()=>{
  beforeAll(async()=>{
    await prisma.user.createMany({data:[
      {id:ownerId,email:"l13a-owner-"+suffix+"@example.test",role:"OWNER"},
      {id:staffId,email:"l13a-staff-"+suffix+"@example.test",role:"STAFF"},
    ]});
    await prisma.telecomAccount.create({data:{
      id:accountId,provider:"twilio",environment:"TEST",
      externalAccountId:"AC"+"e".repeat(32),label:"COM-L13A test",
    }});
  });
  afterAll(async()=>{
    const statements=await prisma.telecomStatement.findMany({
      where:{accountId},select:{id:true},
    });
    await prisma.auditLog.deleteMany({where:{
      entityType:"TelecomStatement",entityId:{in:statements.map(row=>row.id)},
    }});
    await prisma.telecomStatement.deleteMany({where:{accountId}});
    await prisma.telecomAccount.deleteMany({where:{id:accountId}});
    await prisma.user.deleteMany({where:{id:{in:[ownerId,staffId]}}});
    stored.clear();
  });
  it("rejects a fake PDF and prevents any private write from staff",async()=>{
    const count=stored.size;
    await expect(uploadTelecomStatement({...base,bytes:Buffer.from("not a PDF")},store))
      .rejects.toThrow("valid PDF");
    await expect(uploadTelecomStatement({...base,actorUserId:staffId},store))
      .rejects.toThrow("no longer has access");
    expect(stored.size).toBe(count);
  });
  it("keeps verified evidence draft until owner checks the exact private bytes",async()=>{
    const created=await uploadTelecomStatement(base,store);
    expect(created.state).toBe("DRAFT");
    const initial=await prisma.telecomStatement.findUniqueOrThrow({where:{id:created.id}});
    expect(initial.state).toBe("DRAFT");
    expect(initial.privateEvidenceStorageKey).toMatch(/^telecom-statements\//);
    expect(initial.invoiceTotalCents).toBe(1755);
    expect(initial.paidOn).toBeNull();
    expect(initial.verifiedAt).toBeNull();
    await expect(verifyTelecomStatement(staffId,created.id,initial.evidenceHash,store))
      .rejects.toThrow("no longer has access");

    const original=stored.get(initial.privateEvidenceStorageKey)!;
    stored.set(initial.privateEvidenceStorageKey, Buffer.from("%PDF-1.4\n1 0 obj\n<<bad>>\nendobj\ntrailer\n<<>>\n%%EOF"));
    await expect(verifyTelecomStatement(ownerId,created.id,initial.evidenceHash,store))
      .rejects.toThrow("missing or already verified");
    stored.set(initial.privateEvidenceStorageKey,original);
    const verified=await verifyTelecomStatement(ownerId,created.id,initial.evidenceHash,store);
    expect(verified.state).toBe("VERIFIED");
    const db=await prisma.telecomStatement.findUniqueOrThrow({where:{id:created.id}});
    expect(db).toMatchObject({state:"VERIFIED",verifiedByUserId:ownerId});
    expect(db.verifiedAt).not.toBeNull();
    expect(db.paidOn).toBeNull();
    await expect(verifyTelecomStatement(ownerId,created.id,initial.evidenceHash,store))
      .rejects.toThrow("already verified");
    expect(await prisma.auditLog.count({where:{
      entityType:"TelecomStatement",entityId:created.id,
    }})).toBe(2);
  });

  it("appends same-statement revisions without rewriting approved evidence",async()=>{
    const revision=await uploadTelecomStatement({...base,invoiceTotalCents:1800},store);
    const row=await prisma.telecomStatement.findUniqueOrThrow({where:{id:revision.id}});
    expect(row.revision).toBe(2);
    expect(row.state).toBe("DRAFT");
    expect(row.invoiceTotalCents).toBe(1800);
    const first=await prisma.telecomStatement.findFirstOrThrow({
      where:{accountId,externalId:base.externalId,revision:1},
    });
    expect(first.invoiceTotalCents).toBe(1755);
    expect(first.state).toBe("VERIFIED");
  });
});
