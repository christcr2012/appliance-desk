import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// MCP-10a never lets generic ops or unrelated MCP tools read customer
// feedback. MCP-11 introduces exactly one reviewed, scoped MCP bridge, with
// separate reporter consent. Guard against any second unreviewed data path.

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mjs|js)$/.test(name) ? [path] : [];
  });
}

const AGENT_AREAS = ["src/app/api/ops", "src/mcp", "src/domains/mcp", "src/app/api/mcp", "src/lib/mcp"];
const FEEDBACK_REFERENCE = /domains\/feedback|feedbackReport|feedbackEntry|feedbackAttachment|feedback-attachments/;
// A database read of a feedback table, or an import of the feedback domain.
const FEEDBACK_READ = /domains\/feedback|\.feedback(?:Report|Entry|Attachment|Event)\b/;

describe("app feedback has one reviewed, consent-scoped MCP bridge", () => {
  it("only the dedicated MCP server bridge may import feedback, and it never reads its database tables directly", () => {
    const offenders = AGENT_AREAS.flatMap(sourceFiles).filter((file) => FEEDBACK_REFERENCE.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([join("src", "mcp", "server.ts")]);
    const server = readFileSync(join("src", "mcp", "server.ts"), "utf8");
    expect(server).toMatch(/listFeedbackForAgent, getFeedbackForAgent/);
    expect(server).toMatch(/read\("feedback:triage"/);
    expect(server).not.toMatch(/\.feedback(?:Report|Entry|Attachment|Event)\b/);
    expect(server).not.toMatch(/feedbackAttachment|attachmentUrl|screenshotUrl/);
  });

  it("no other MCP or ops agent file opens a feedback content path", () => {
    const offenders = sourceFiles("src")
      .filter((file) => !file.includes(join("domains", "feedback")))
      .filter((file) => file !== join("src", "mcp", "server.ts"))
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        return /opsAgentKey|OpsAgentKey|McpServer|registerTool\(/.test(text) && FEEDBACK_READ.test(text);
      });
    expect(offenders).toEqual([]);
  });

  it("reporters alone can opt in, and report text requires a separate live content grant", () => {
    const domain = readFileSync("src/domains/feedback/index.ts", "utf8");
    expect(domain).toMatch(/aiReview: "HUMAN_ONLY"/);
    expect(domain).toMatch(/export async function setFeedbackAiReview/);
    expect(domain).toMatch(/const actor = await reporterActor\(\)/);
    expect(domain).toMatch(/await lockReport\(tx, id, actor\.id\)/);
    expect(domain).toMatch(/previous\.aiReview === "HUMAN_ONLY" \? "HUMAN_ONLY" : "WITHDRAWN"/);
    expect(domain).toMatch(/action: "AI_PERMISSION_CHANGED"/);
    const bridge = readFileSync("src/domains/feedback/agent.ts", "utf8");
    expect(bridge).toMatch(/ctx\.scopes\.includes\("feedback:content"\)/);
    expect(bridge).toMatch(/row\.aiReview === "ALLOWED"/);
    expect(bridge).toMatch(/row\.contentRemovedAt === null/);
    expect(bridge).not.toMatch(/feedbackAttachment|attachmentUrl|screenshotUrl/);
    const migration = readFileSync("prisma/migrations/20261027020000_feedback/migration.sql", "utf8");
    expect(migration).toMatch(/"aiReview" "FeedbackAiReview" NOT NULL DEFAULT 'HUMAN_ONLY'/);
  });

  it("the words never mix app feedback up with appliance repairs", () => {
    const form = readFileSync("src/components/feedback/feedback-form.tsx", "utf8");
    const views = readFileSync("src/components/feedback/views.tsx", "utf8");
    expect(views).toContain("This is for problems with this website or app.");
    expect(views).toContain("Appliance not working?");
    expect(views).toContain("/account/maintenance?request=repair");
    expect(form).toContain("Chris and his team read these. Don&apos;t include passwords, card numbers or access codes.");
    expect(form).not.toMatch(/repair/i);
  });
});
