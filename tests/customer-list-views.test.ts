import { describe, expect, it } from "vitest";
import { customerListWhere } from "@/domains/customers";

describe("AR-12 customer list filters", () => {
  it("hides walk-in and archived customers in every view", () => {
    expect(customerListWhere()).toMatchObject({archivedAt:null,isWalkIn:false});
  });
  it("Renting now and Property managers reflect database facts", () => {
    expect(customerListWhere({status:"active",kind:"pm"})).toMatchObject({
      archivedAt:null,isWalkIn:false,
      rentalAgreements:{some:{status:"ACTIVE"}},isPropertyManager:true,
    });
  });
  it("searches names, email and company names without dropping business restrictions", () => {
    const result=customerListWhere({q:" Lopez  "});
    expect(result.archivedAt).toBeNull();
    expect(result.OR).toHaveLength(3);
    expect(JSON.stringify(result.OR)).toContain("Lopez");
    expect(JSON.stringify(result.OR)).toContain("insensitive");
  });
  it("unknown URL filters never change the data predicate", () => {
    expect(customerListWhere({status:"other" as never,kind:"else" as never})).toEqual(customerListWhere());
  });
});
