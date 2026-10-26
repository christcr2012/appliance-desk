import { describe,expect,it } from "vitest";
import { selectFairBooksCandidates } from "@/domains/books/post";

describe("Books pending source fairness",()=>{
 const at=(day:number)=>new Date(Date.UTC(2026,0,day));
 it("books today's invoice even with 500 older unfinished appliance entries",()=>{
  const old=Array.from({length:500},(_,i)=>({
   type:"APPLIANCE",id:"equipment-"+i,at:at(1),
  }));
  const invoice={type:"INVOICE",id:"new-bill",at:at(25)};
  const selected=selectFairBooksCandidates([...old,invoice],500);
  expect(selected).toHaveLength(500);
  expect(selected).toContainEqual(invoice);
  expect(selected.filter(x=>x.type==="APPLIANCE")).toHaveLength(499);
 });
 it("does not displace the oldest entry for tiny batches",()=>{
  const rows=[{type:"APPLIANCE",id:"a",at:at(1)},
   {type:"INVOICE",id:"b",at:at(2)},{type:"REFUND",id:"c",at:at(3)}];
  expect(selectFairBooksCandidates(rows,1)).toEqual([rows[0]]);
  expect(selectFairBooksCandidates(rows,0)).toEqual([]);
 });
 it("repeated scheduled runs can select the next older source after work is posted",()=>{
  let outstanding=Array.from({length:520},(_,i)=>({
   type:"APPLIANCE",id:"asset-"+i,at:at(1),
  }));
  const result=[];
  while(outstanding.length){
   const next=selectFairBooksCandidates(outstanding,200);
   result.push(...next);
   const ids=new Set(next.map(x=>x.id));
   outstanding=outstanding.filter(x=>!ids.has(x.id));
  }
  expect(result).toHaveLength(520);
  expect(new Set(result.map(x=>x.id)).size).toBe(520);
 });
});
