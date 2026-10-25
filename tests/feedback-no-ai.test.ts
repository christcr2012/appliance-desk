import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// MCP-10a: no AI or ops route can reach app feedback content in this unit. Reports are people-only (HUMAN_ONLY);
// the AI opt-in and agent tools are MCP-11. This is a source check, so a later change that wires feedback into an ops
// or MCP path fails here until it is reviewed on purpose.

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

describe("app feedback stays out of AI and ops tools", () => {
  it("no ops or MCP module imports the feedback domain or reads feedback tables", () => {
    const offenders = AGENT_AREAS.flatMap(sourceFiles).filter((file) => FEEDBACK_REFERENCE.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("no file anywhere that mentions an MCP tool or ops agent key reads feedback content", () => {
    const offenders = sourceFiles("src")
      .filter((file) => !file.includes(join("domains", "feedback")))
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        return /opsAgentKey|OpsAgentKey|McpServer|registerTool\(/.test(text) && FEEDBACK_READ.test(text);
      });
    expect(offenders).toEqual([]);
  });

  it("every report is stored HUMAN_ONLY and nothing in the app sets another value", () => {
    const domain = readFileSync("src/domains/feedback/index.ts", "utf8");
    expect(domain).toMatch(/aiReview: "HUMAN_ONLY"/);
    const writers = sourceFiles("src").filter((file) => /aiReview\s*:\s*"(ALLOWED|WITHDRAWN)"/.test(readFileSync(file, "utf8")));
    expect(writers).toEqual([]);
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
