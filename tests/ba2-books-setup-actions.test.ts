import { beforeEach, describe, expect, it, vi } from "vitest";

const m=vi.hoisted(()=>({
 role:vi.fn(),initialize:vi.fn(),correct:vi.fn(),auto:vi.fn(),
 revalidate:vi.fn(),redirect:vi.fn(),
}));
vi.mock("@/lib/session",()=>({requireRole:m.role}));
vi.mock("@/domains/books/management",()=>({
 initializeBooks:m.initialize,correctOpeningBalances:m.correct,
}));
vi.mock("@/domains/books/autopilot",()=>({runBooksAutopilot:m.auto}));
vi.mock("next/cache",()=>({revalidatePath:m.revalidate}));
vi.mock("next/navigation",()=>({
 redirect:(path:string)=>{
  m.redirect(path);
  throw {digest:"NEXT_REDIRECT",destination:path};
 },
}));
import { startBooksWizardAction,correctOpeningBalancesAction } from "@/app/desk/books/actions";

function form(input:Record<string,string>){
 const data=new FormData();for(const [key,value] of Object.entries(input))data.set(key,value);
 return data;
}
const defaults={startDate:"2026-10-25",newBusiness:"yes",
 bank:"100.00",stripe:"20.00",card:"50.00"};
describe("BA-2 setup server actions and owner enforcement",()=>{
 beforeEach(()=>{
  vi.clearAllMocks();
  m.role.mockResolvedValue({user:{id:"owner-example",role:"OWNER"}});
  m.initialize.mockResolvedValue(undefined);
  m.correct.mockResolvedValue({eventKind:"OPENING_CORRECTED_1"});
  m.auto.mockResolvedValue({posted:1,enrolled:2,depreciated:3,problems:0});
 });
 it("requires the owner role before reading or changing balances",async()=>{
  await startBooksWizardAction(form(defaults)).catch(()=>undefined);
  expect(m.role).toHaveBeenCalledWith("OWNER");
  expect(m.initialize).toHaveBeenCalledWith({id:"owner-example",role:"OWNER"},{
   startDate:"2026-10-25",bankCents:0,stripeCents:0,cardCents:0,
  });
  expect(m.auto).toHaveBeenCalledWith(expect.any(Date),{
   maxSources:12,maxEnrollments:12,maxDepreciations:12,
  });
 });
 it("uses owner-attested opening numbers, in whole cents, for an existing business",async()=>{
  await startBooksWizardAction(form({...defaults,newBusiness:"no"})).catch(()=>undefined);
  expect(m.initialize).toHaveBeenCalledWith(expect.any(Object),{
   startDate:"2026-10-25",bankCents:10000,stripeCents:2000,cardCents:5000,
  });
 });
 it("never reruns the Books autopilot when the initialization failed",async()=>{
  m.initialize.mockRejectedValue(new Error("Books already initialized."));
  await startBooksWizardAction(form(defaults)).catch(()=>undefined);
  expect(m.auto).not.toHaveBeenCalled();
  expect(m.redirect).toHaveBeenCalledWith(expect.stringContaining("/desk/books/setup?notice="));
 });
 it("a later nightly problem cannot undo a successfully saved opening",async()=>{
  m.auto.mockRejectedValue(new Error("Nightly import unavailable"));
  await startBooksWizardAction(form(defaults)).catch(()=>undefined);
  expect(m.initialize).toHaveBeenCalledOnce();
  expect(m.redirect).toHaveBeenCalledWith(expect.stringContaining("/desk/books?notice="));
 });
 it("corrects exact cent balances with a required owner-only action",async()=>{
  await correctOpeningBalancesAction(form({
   bank:"100.25",stripe:"0.00",card:"23.00",reason:"Bank statement corrected",
  })).catch(()=>undefined);
  expect(m.role).toHaveBeenCalledWith("OWNER");
  expect(m.correct).toHaveBeenCalledWith({id:"owner-example",role:"OWNER"},{
   bankCents:10025,stripeCents:0,cardCents:2300,reason:"Bank statement corrected",
  });
  expect(m.redirect).toHaveBeenCalledWith(expect.stringContaining("OPENING_CORRECTED_1"));
 });
});
