import { beforeEach,describe,expect,it,vi } from "vitest";
const m=vi.hoisted(()=>({
 role:vi.fn(),close:vi.fn(),settings:vi.fn(),send:vi.fn(),redirect:vi.fn(),revalidate:vi.fn(),
}));
vi.mock("@/lib/session",()=>({requireRole:m.role}));
vi.mock("next/cache",()=>({revalidatePath:m.revalidate}));
vi.mock("next/navigation",()=>({redirect:(path:string)=>{m.redirect(path);throw {digest:"NEXT_REDIRECT"};}}));
vi.mock("@/domains/books/management",()=>({closeAccountingMonthWithReview:m.close}));
vi.mock("@/domains/books/accountant-packet",()=>({
 saveAccountantReviewSettings:m.settings,sendMonthToAccountant:m.send,
}));
import {lockReviewedMonthAction,accountantReviewSettingsAction,sendAccountantMonthAction} from "@/app/desk/books/actions";
const form=(values:Record<string,string>)=>{
 const data=new FormData();
 for(const [k,v] of Object.entries(values))data.set(k,v);
 return data;
};
describe("BA-3 real month server action validation",()=>{
 beforeEach(()=>{
  vi.clearAllMocks();
  m.role.mockResolvedValue({user:{id:"owner-test",role:"OWNER"}});
  m.close.mockResolvedValue({alreadyClosed:false,exported:true});
  m.settings.mockResolvedValue(undefined);
  m.send.mockResolvedValue({outcome:"NOT_ATTEMPTED",message:"Email not configured"});
 });
 it("accepts a real YYYY-MM month in all three owner-only actions",async()=>{
  await lockReviewedMonthAction(form({month:"2026-09"})).catch(()=>undefined);
  await accountantReviewSettingsAction(form({month:"2026-09",accountantEmail:"",reminderDay:"15"})).catch(()=>undefined);
  await sendAccountantMonthAction(form({month:"2026-09"})).catch(()=>undefined);
  expect(m.role).toHaveBeenCalledTimes(3);
  expect(m.role).toHaveBeenCalledWith("OWNER");
  expect(m.close).toHaveBeenCalledWith({id:"owner-test",role:"OWNER"},"2026-09",
   {expenses:"",payments:""});
  expect(m.settings).toHaveBeenCalledWith(expect.any(Object),{accountantEmail:"",reminderDay:15});
  expect(m.send).toHaveBeenCalledWith(expect.any(Object),"2026-09");
 });
 it("rejects malformed months before invoking accounting, settings or email",async()=>{
  await expect(lockReviewedMonthAction(form({month:"2026-00"}))).rejects.toThrow();
  await expect(accountantReviewSettingsAction(form({month:"2026-13"}))).rejects.toThrow();
  await expect(sendAccountantMonthAction(form({month:"../2026-09"}))).rejects.toThrow();
  expect(m.close).not.toHaveBeenCalled();
  expect(m.settings).not.toHaveBeenCalled();
  expect(m.send).not.toHaveBeenCalled();
 });
});
