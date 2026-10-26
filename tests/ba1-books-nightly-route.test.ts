import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const stub = vi.hoisted(() => ({
  cronAuthorized: vi.fn(),
  runAutomation: vi.fn(),
  runBooksAutopilot: vi.fn(),
  runStripeBooksNightly: vi.fn(),
  settingsFind: vi.fn(),
}));

vi.mock("@/lib/cron-auth", () => ({ cronAuthorized: stub.cronAuthorized }));
vi.mock("@/domains/automation/runs", () => ({ runAutomation: stub.runAutomation }));
vi.mock("@/domains/books/autopilot", () => ({ runBooksAutopilot: stub.runBooksAutopilot }));
vi.mock("@/domains/books/stripe-balance", () => ({ runStripeBooksNightly: stub.runStripeBooksNightly }));
vi.mock("@/lib/prisma", () => ({ prisma: { businessSettings: { findUnique: stub.settingsFind } } }));

import { GET } from "@/app/api/cron/books-nightly/route";

const beforeSecret=process.env.CRON_SECRET;
const beforeStripe=process.env.BOOKS_STRIPE_SYNC_ENABLED;
const request=()=>new Request("https://example.test/api/cron/books-nightly", {
 headers:{authorization:"Bearer test-cron"},
});

describe("BA-1 nightly jobs",()=>{
 beforeEach(()=>{
  vi.clearAllMocks();
  process.env.CRON_SECRET="test-cron";
  delete process.env.BOOKS_STRIPE_SYNC_ENABLED;
  stub.cronAuthorized.mockReturnValue(true);
  stub.settingsFind.mockResolvedValue({booksStartDate:new Date("2026-01-01T07:00:00Z")});
  stub.runBooksAutopilot.mockResolvedValue({posted:1,enrolled:2,depreciated:3,skipped:0,problems:0});
  stub.runStripeBooksNightly.mockResolvedValue({
   sync:{state:"COMPLETE",pages:1,transactions:1},clearing:{state:"MATCHED"},posted:1,
  });
  stub.runAutomation.mockImplementation(async ({ruleKey,work}:{ruleKey:string;work:()=>Promise<unknown>})=>{
   await work();
   return {outcome:"SUCCEEDED",ruleKey};
  });
 });
 afterEach(()=>{
  if(beforeSecret===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=beforeSecret;
  if(beforeStripe===undefined)delete process.env.BOOKS_STRIPE_SYNC_ENABLED;
  else process.env.BOOKS_STRIPE_SYNC_ENABLED=beforeStripe;
 });
 it("records without enabling Stripe and reports Stripe as paused",async()=>{
  const response=await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({recording:{ruleKey:"books-nightly:record"},
   stripe:{outcome:"PAUSED"}});
  expect(stub.runBooksAutopilot).toHaveBeenCalledOnce();
  expect(stub.runAutomation).toHaveBeenCalledTimes(1);
  expect(stub.runStripeBooksNightly).not.toHaveBeenCalled();
 });
 it("requires the cron secret before any financial read or write",async()=>{
  stub.cronAuthorized.mockReturnValue(false);
  const response=await GET(request());
  expect(response.status).toBe(401);
  expect(stub.settingsFind).not.toHaveBeenCalled();
  expect(stub.runBooksAutopilot).not.toHaveBeenCalled();
 });
 it("does not start until the owner has initialized Books",async()=>{
  stub.settingsFind.mockResolvedValue({booksStartDate:null});
  const response=await GET(request());
  expect((await response.json()).outcome).toBe("PAUSED");
  expect(stub.runAutomation).not.toHaveBeenCalled();
 });
 it("runs Stripe reconciliation separately only after explicit switch",async()=>{
  process.env.BOOKS_STRIPE_SYNC_ENABLED="true";
  const response=await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
   recording:{ruleKey:"books-nightly:record"},
   stripe:{ruleKey:"books-nightly:stripe"},
  });
  expect(stub.runAutomation.mock.calls.map(c=>c[0].ruleKey)).toEqual([
   "books-nightly:record","books-nightly:stripe",
  ]);
  expect(stub.runStripeBooksNightly).toHaveBeenCalledOnce();
 });
});
