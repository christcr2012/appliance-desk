import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const runAutomation = vi.fn();
const createDueRecurringExpenses = vi.fn();
vi.mock("@/domains/automation/runs", () => ({
  runAutomation: (...args: unknown[]) => runAutomation(...args),
}));
vi.mock("@/domains/books/expenses", () => ({
  createDueRecurringExpenses: (...args: unknown[]) => createDueRecurringExpenses(...args),
}));
import { GET } from "@/app/api/cron/expense-drafts/route";

const saved = process.env.CRON_SECRET;
afterAll(() => {
  if (saved === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = saved;
});
beforeEach(() => { runAutomation.mockReset(); createDueRecurringExpenses.mockReset(); });
describe("K-4 recurring drafts guarded scheduler", () => {
  it("refuses absent configuration or invalid authorization before any source calls", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(new Request("https://example.test/api/cron/expense-drafts"))).status).toBe(500);
    process.env.CRON_SECRET = "test-only";
    expect((await GET(new Request("https://example.test/api/cron/expense-drafts"))).status).toBe(401);
    expect(createDueRecurringExpenses).not.toHaveBeenCalled();
    expect(runAutomation).not.toHaveBeenCalled();
  });
  it("records private draft count through the idempotent automation runner", async () => {
    process.env.CRON_SECRET = "test-only";
    createDueRecurringExpenses.mockResolvedValue(2);
    runAutomation.mockImplementation(async (args: {work: () => Promise<unknown>}) => args.work());
    const response = await GET(new Request("https://example.test/api/cron/expense-drafts", {
      headers: { authorization: "Bearer test-only" },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({counts:{drafts:2}});
    expect(runAutomation.mock.calls[0][0]).toMatchObject({ruleKey:"expense-drafts",budgetSeconds:60});
  });
});
