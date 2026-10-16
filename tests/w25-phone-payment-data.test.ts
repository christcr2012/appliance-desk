import {describe,it,expect} from "vitest";
import {rejectPhonePaymentCredentials} from "@/domains/orders/phone-payment-data";
describe("W-25 never records phone-taken payment credentials",()=>{
  it("rejects common valid PANs with spaces or dashes",()=>{
    expect(()=>rejectPhonePaymentCredentials("Caller said 4111 1111 1111 1111"))
      .toThrow(/card numbers/i);
    expect(()=>rejectPhonePaymentCredentials("No 5555-5555-5555-4444 here"))
      .toThrow(/card numbers/i);
  });
  it("rejects security codes but permits phone numbers, dollar amounts and dates",()=>{
    expect(()=>rejectPhonePaymentCredentials("CVV: 123")).toThrow(/security codes/i);
    expect(()=>rejectPhonePaymentCredentials("CVC 5432")).toThrow(/security codes/i);
    expect(()=>rejectPhonePaymentCredentials("Call 303-555-0123, 2 washers, $60/month, 2026-10-16"))
      .not.toThrow();
  });
  it("does not log raw credential strings in errors",()=>{
    try {rejectPhonePaymentCredentials("4111111111111111");}
    catch(e){expect(String(e)).not.toContain("4111111111111111");}
  });
});
