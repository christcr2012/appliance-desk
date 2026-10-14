import { describe,expect,it } from "vitest";
import { completeConvertedEstimateScope } from "@/domains/estimates/finalized-order";
const rows=[
  {id:"a",customerId:"customer-1",sourceEstimateId:"estimate-1"},
  {id:"b",customerId:"customer-1",sourceEstimateId:"estimate-1"},
];
describe("W-22FIN final estimate price only from one complete owned converted order",()=>{
  it("sorts and accepts all linked agreements only when the set is complete",()=>{
    expect(completeConvertedEstimateScope([...rows].reverse(),2,"estimate-1","customer-1")).toEqual(["a","b"]);
  });
  it("refuses hidden foreign sibling, duplicate, mismatched source and empty estimate",()=>{
    expect(completeConvertedEstimateScope(rows,3,"estimate-1","customer-1")).toBeNull();
    expect(completeConvertedEstimateScope([rows[0],rows[0]],2,"estimate-1","customer-1")).toBeNull();
    expect(completeConvertedEstimateScope([rows[0],{...rows[1],customerId:"customer-2"}],2,"estimate-1","customer-1")).toBeNull();
    expect(completeConvertedEstimateScope([rows[0],{...rows[1],sourceEstimateId:"other"}],2,"estimate-1","customer-1")).toBeNull();
    expect(completeConvertedEstimateScope([],0,"estimate-1","customer-1")).toBeNull();
    expect(completeConvertedEstimateScope(rows,2,"estimate-1","")).toBeNull();
  });
});
