import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * LD-1: mergeLeads (src/domains/leads/merge.ts) must move every child row
 * that points at a lead. If a new model gains a `leadId` column and nobody
 * teaches the merge about it, this test fails instead of silently orphaning
 * that child's history on a merged lead.
 */
const SCHEMA = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
const MERGE = readFileSync(join(process.cwd(), "src", "domains", "leads", "merge.ts"), "utf8");

function modelsWithLeadId(): string[] {
  const found: string[] = [];
  const blocks = SCHEMA.split(/^model (\w+) \{/m);
  // split gives [prelude, name, body, name, body, ...]
  for (let i = 1; i < blocks.length; i += 2) {
    if (/^\s*leadId\s+String\??\s/m.test(blocks[i + 1])) found.push(blocks[i]);
  }
  return found.sort();
}

describe("lead merge schema coverage", () => {
  it("every model with a leadId column is moved by mergeLeads", () => {
    const models = modelsWithLeadId();
    expect(models).toEqual([
      "CommunicationThread",
      "ConsentRecord",
      "ContactBinding",
      "Estimate",
      "LeadApplianceRequest",
      "LeadNote",
      "StaffTask",
    ]);
    for (const model of models) {
      const client = model[0].toLowerCase() + model.slice(1);
      expect(MERGE, `${model} is not moved by mergeLeads`).toContain(
        `tx.${client}.updateMany({ where: { leadId: mergeId }`,
      );
    }
  });

  it("mergeLeads also moves deliveries and links, which point at leads by id", () => {
    expect(MERGE).toContain('recipientType: "Lead", recipientId: mergeId');
    expect(MERGE).toContain('entityType: "Lead", entityId: mergeId');
  });
});
