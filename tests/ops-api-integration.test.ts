import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createOpsAgentKey, revokeOpsAgentKey, verifyOpsAgentKey } from "@/domains/system-issues/ops-auth";
import { addStructuredAgentNote, getOpsIssues, OpsRequestError, parseStructuredAgentNote } from "@/domains/system-issues/ops-api";
import { GET } from "@/app/api/ops/issues/route";
import { POST } from "@/app/api/ops/issues/[id]/notes/route";
import { BACKUP_TABLES, BACKUP_MODEL_POLICY } from "@/domains/backup/manifest";
import { buildDatabaseBackupSnapshot } from "@/domains/backup";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const enabled = process.env.CI === "true" && url.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(url.hostname);

const makeNote = (expectedVersion = 1) => ({
  category: "CODE_FINDING", codeReferences: ["src/domains/system-issues/ops-api.ts"],
  recommendationKey: "INVESTIGATE_CODE", expectedVersion,
});

async function fixture(test: (state: { key: string; id: string; issueId: string; ownerId: string; adminId: string }) => Promise<void>) {
  const owner = await prisma.user.findFirstOrThrow({ where: { role: "OWNER", archivedAt: null }, select: { id: true } });
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN", archivedAt: null }, select: { id: true } });
  const created = await createOpsAgentKey(owner.id, "Test checkup " + randomUUID().slice(0, 6));
  const row = await prisma.opsAgentKey.findFirstOrThrow({ where: { keyHash: { not: "" }, revokedAt: null, id: created.id } });
  const issue = await prisma.systemIssue.create({ data: {
    fingerprint: "automation:ops-api-" + randomUUID().replaceAll("-", ""),
    kind: "AUTOMATION_FAILED", severity: "HIGH", summary: "Test diagnostics", detail: "Safe typed test details",
  } });
  try { await test({key:created.key,id:row.id,issueId:issue.id,ownerId:owner.id,adminId:admin.id}); }
  finally {
    await prisma.systemIssueNote.deleteMany({ where: { issueId: issue.id } });
    await prisma.systemIssue.delete({ where: { id: issue.id } });
    await prisma.opsAgentKey.delete({ where: { id: created.id } });
  }
}
const token = (key?: string): Record<string, string> => key ? { authorization: "Bearer " + key } : {};

describe.skipIf(!enabled)("S-2 private check-up API on disposable Postgres", () => {
  it("missing or malformed key returns 404; valid bearer reads typed, private summaries", async () => {
    await fixture(async ({ key, issueId }) => {
      expect((await GET(new NextRequest("http://localhost/api/ops/issues"))).status).toBe(404);
      expect((await GET(new NextRequest("http://localhost/api/ops/issues", { headers: token("bad") }))).status).toBe(404);
      const response = await GET(new NextRequest("http://localhost/api/ops/issues?limit=100", { headers: token(key) }));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const data = await response.json();
      const record = data.issues.find((item: {id:string}) => item.id === issueId);
      expect(record).toMatchObject({summary:"Test diagnostics",version:1});
      for (const field of ["notes", "fingerprint", "authorUserId", "authorKeyId", "resolvedReason", "keyHash"])
        expect(record).not.toHaveProperty(field);
      expect(await getOpsIssues({limit:5})).toHaveProperty("issues");
    });
  });

  it("keys are hashed and revoked immediately; admin cannot issue or revoke", async () => {
    await fixture(async ({key,id,adminId}) => {
      const saved = await prisma.opsAgentKey.findUniqueOrThrow({where:{id}});
      expect(saved.keyHash).not.toBe(key);
      expect(await verifyOpsAgentKey(key)).toMatchObject({id});
      await expect(createOpsAgentKey(adminId, "Not allowed")).rejects.toThrow();
      await expect(revokeOpsAgentKey(adminId,id)).rejects.toThrow();
      const owner = await prisma.user.findFirstOrThrow({where:{role:"OWNER"},select:{id:true}});
      await revokeOpsAgentKey(owner.id,id);
      expect(await verifyOpsAgentKey(key)).toBeNull();
      expect((await GET(new NextRequest("http://localhost/api/ops/issues", { headers: token(key) }))).status).toBe(404);
    });
  });

  it("accepts only structured allowlisted notes, rejects arbitrary bodies and external URLs", async () => {
    await fixture(async ({key,issueId,id}) => {
      for (const unsafe of [
        {...makeNote(),body:"Send password to jane@example.com"},
        {...makeNote(),prUrl:"https://evil.test/pull/1"},
        {...makeNote(),codeReferences:["../private.env"]},
        {...makeNote(),codeReferences:["src/not-real-secrets.ts"]},
      ]) expect(() => parseStructuredAgentNote(unsafe)).toThrow(OpsRequestError);
      const response = await POST(new NextRequest("http://localhost/api/ops/issues/"+issueId+"/notes", {
        method:"POST", headers: {...token(key), "Content-Type":"application/json"}, body:JSON.stringify(makeNote()),
      }), {params:Promise.resolve({id:issueId})});
      expect(response.status).toBe(200);
      const row = await prisma.systemIssue.findUniqueOrThrow({where:{id:issueId},include:{notes:true}});
      expect(row).toMatchObject({status:"ACKNOWLEDGED",version:2});
      expect(row.notes).toHaveLength(1);
      expect(row.notes[0]).toMatchObject({authorKeyId:id});
      expect(row.notes[0].body).not.toMatch(/password|jane@example/);
      const backup = await buildDatabaseBackupSnapshot();
      const persisted = (backup.payload.tables.systemIssueNote ?? []) as Array<{id:string; authorKeyId:string|null}>;
      expect(persisted.find(x => x.id === row.notes[0].id)?.authorKeyId).toBeNull();
      expect(backup.payload.tables).not.toHaveProperty("opsAgentKey");
    });
  });

  it("resolved issue stays resolved if the agent's structured note arrives later; stale version conflicts", async () => {
    await fixture(async ({issueId,id}) => {
      await prisma.systemIssue.update({where:{id:issueId},data:{status:"RESOLVED",version:2,resolvedAt:new Date()}});
      await addStructuredAgentNote(id,issueId,makeNote(2));
      expect((await prisma.systemIssue.findUniqueOrThrow({where:{id:issueId}})).status).toBe("RESOLVED");
      await expect(addStructuredAgentNote(id,issueId,makeNote(2))).rejects.toMatchObject({status:409});
      expect(await prisma.systemIssueNote.count({where:{issueId}})).toBe(1);
    });
  });

  it("60 requests per key per hour then rate-limit 429", async () => {
    await fixture(async ({key,id}) => {
      // Check the durable limiter's rolling count directly so this test need not request 61 full issue pages.
      const { isRateLimited } = await import("@/lib/rate-limit");
      for(let i=0;i<59;i++) expect(await isRateLimited("ops-checkup:"+id,{max:60,windowMs:3600000})).toBe(false);
      expect((await GET(new NextRequest("http://localhost/api/ops/issues",{headers:token(key)}))).status).toBe(200);
      const blocked=await GET(new NextRequest("http://localhost/api/ops/issues",{headers:token(key)}));
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("cache-control")).toBe("no-store");
    });
  });

  it("secret key hashes excluded from recovery manifest", () => {
    expect(BACKUP_MODEL_POLICY.OpsAgentKey).toBeNull();
    expect(BACKUP_TABLES).not.toContain("opsAgentKey");
  });
});
