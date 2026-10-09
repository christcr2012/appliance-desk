import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { assertNoKnownPersonNames, redactForOps } from "@/domains/system-issues/ops-redaction";
import { renderSystemIssue } from "@/domains/system-issues/render";

const conn = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const enabled = process.env.CI === "true" && conn.pathname === "/appliance_desk_test" && ["localhost", "127.0.0.1"].includes(conn.hostname);

describe("S-1A private note redaction", () => {
  it("removes planted email, phone, street address, card digits and credential formats", () => {
    const samples = [
      "person@example.test", "(303) 555-0102", "1234 Main Street",
      "4111 1111 1111 1111", "Bearer synthetic-token-value",
      '{"message":"private provider error","customer":"test@example.test"}',
      "sk_placeholder_dummyexample123",
    ];
    for (const sample of samples) {
      const cleaned = redactForOps("Problem observed: " + sample);
      expect(cleaned).not.toContain(sample);
      expect(cleaned).toContain("Problem observed:");
    }
  });
  it("does not allow oversized text", () => {
    expect(() => redactForOps("a".repeat(2049))).toThrow(/2 KB/);
  });
  it("exportable issue templates reject arbitrary messages, person names and codes", () => {
    expect(() => renderSystemIssue({
      kind: "AUTOMATION_FAILED", ruleKey: "backup", runId: "run1",
      startedAt: new Date(), errorName: "Jane Smith",
    })).toThrow(/Unrecognized/);
    const structured = renderSystemIssue({
      kind: "AUTOMATION_FAILED", ruleKey: "backup", runId: "run1",
      startedAt: new Date("2026-10-08T21:00:00Z"), errorName: "TimeoutError",
    });
    expect(structured.summary).not.toContain("Jane");
    expect(structured).not.toHaveProperty("notes");
    expect(structured).not.toHaveProperty("resolvedReason");
  });
});

describe.skipIf(!enabled)("S-1A name rejection on throwaway Postgres", () => {
  it("rejects a known person's full name and an adjacent titled surname", async () => {
    const marker = randomUUID().replaceAll("-", "");
    const lastName = "Testson" + marker.slice(0, 7);
    const staff = await prisma.user.create({data:{
      email: "ops-private-" + marker + "@example.test", name: "Jane " + lastName, role: "STAFF",
    }});
    try {
      await prisma.$transaction(async (tx) => {
        await expect(assertNoKnownPersonNames(tx, "Lookup failed for Jane " + lastName)).rejects.toThrow(/without names/);
        await expect(assertNoKnownPersonNames(tx, "Lookup failed for Alice " + lastName)).rejects.toThrow(/without names/);
        await expect(assertNoKnownPersonNames(tx, "Configuration needs attention")).resolves.toBeUndefined();
      });
    } finally {
      await prisma.user.delete({where:{id:staff.id}});
    }
  });
});
