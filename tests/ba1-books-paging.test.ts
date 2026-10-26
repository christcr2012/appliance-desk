import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({
  due: [] as string[],
  completed: [] as string[],
  postPending: vi.fn(),
  depreciation: vi.fn(),
  enrollment: vi.fn(),
  settings: vi.fn(),
  updateSettings: vi.fn(),
}));
vi.mock("@/domains/books/post",()=>({postPending:mocks.postPending}));
vi.mock("@/domains/books/fixed-assets",()=>({
  enrollBookAssetInTx:mocks.enrollment,
  postBookDepreciationInTx:mocks.depreciation,
}));
vi.mock("@/lib/prisma",()=>{
 const tx={
  $queryRaw:vi.fn().mockResolvedValue([]),
  businessSettings:{
   findUniqueOrThrow:vi.fn().mockResolvedValue({booksConsecutiveFailedNights:0}),
   update:mocks.updateSettings,
  },
 };
 return {prisma:{
  businessSettings:{findUnique:mocks.settings},
  appliance:{findMany:vi.fn().mockResolvedValue([])},
  bookAsset:{findMany:vi.fn().mockImplementation(({where,take}:{
   where:{retiredOn:null;fullyDepreciatedOn:null;lastDepreciationMonth?:unknown},take:number,
  })=>{
   // Every completed record is excluded by the database query. We model only
   // the unfinished records, which must advance across nights in pages.
   expect(where.retiredOn).toBeNull();
   expect(where.fullyDepreciatedOn).toBeNull();
   expect(take).toBe(200);
   return mocks.due.slice(0,take).map(applianceId=>({applianceId}));
  })},
  booksProblem:{upsert:vi.fn(),findMany:vi.fn().mockResolvedValue([]),update:vi.fn()},
  $transaction:vi.fn((fn:(tx:typeof tx)=>Promise<unknown>)=>fn(tx)),
 }};
});
import { runBooksAutopilot } from "@/domains/books/autopilot";

describe("BA-1 depreciation page fairness",()=>{
 beforeEach(()=>{
  vi.clearAllMocks();
  mocks.due=[];
  mocks.completed=[];
  mocks.settings.mockResolvedValue({booksStartDate:new Date("2026-01-01T07:00:00Z")});
  mocks.postPending.mockResolvedValue({posted:0,problems:[]});
  mocks.depreciation.mockImplementation(async(_tx:unknown,_actor:unknown,id:string,_through:string,opts:{maxMonths:number})=>{
   expect(opts.maxMonths).toBe(360);
   const i=mocks.due.indexOf(id);
   expect(i).toBeGreaterThanOrEqual(0);
   mocks.due.splice(i,1);
   mocks.completed.push(id);
   return {posted:1,lastCompleted:"2026-04"};
  });
  mocks.updateSettings.mockResolvedValue({});
 });
 it("ignores 200 fully depreciated assets, then finishes 450 owing assets in three nightly batches",async()=>{
  const fullyDepreciated=new Set(Array.from({length:200},(_,i)=>"done-"+i));
  mocks.due=Array.from({length:450},(_,i)=>"owing-"+i);
  const today=new Date("2026-05-05T15:00:00Z");
  const results=[await runBooksAutopilot(today),await runBooksAutopilot(today),await runBooksAutopilot(today)];
  expect(results.map(r=>r.depreciated)).toEqual([200,200,50]);
  expect(mocks.completed).toHaveLength(450);
  expect(new Set(mocks.completed).size).toBe(450);
  expect([...fullyDepreciated].some(id=>mocks.completed.includes(id))).toBe(false);
  expect(mocks.due).toHaveLength(0);
 });
});
