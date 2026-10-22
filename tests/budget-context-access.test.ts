import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,describe,expect,it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getBudgetContext } from "@/domains/budget/context";
import { getBudgetPlanning } from "@/domains/budget/planning";

const database=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&["localhost","127.0.0.1"].includes(database.hostname)
 &&database.pathname==="/appliance_desk_test";
const suffix=randomUUID().slice(0,12);
const owner="budget-context-owner-"+suffix,staff="budget-context-staff-"+suffix,
 customer="budget-context-customer-"+suffix;
describe.skipIf(!enabled)("K-CASH-5B source-shaped server authorization (disposable PostgreSQL)",()=>{
 beforeAll(async()=>{
  await prisma.user.createMany({data:[
   {id:owner,role:"OWNER",email:owner+"@example.test"},
   {id:staff,role:"STAFF",email:staff+"@example.test"},
   {id:customer,role:"CUSTOMER",email:customer+"@example.test"}]});
 });
 afterAll(async()=>{await prisma.user.deleteMany({where:{id:{in:[owner,staff,customer]}}});});
 it("never assembles protected figures in the staff DTO",async()=>{
  const labels=await getBudgetContext(staff);
  expect(labels.role).toBe("STAFF");
  expect(labels.envelopes.length).toBeGreaterThan(0);
  for(const item of labels.envelopes)expect(Object.keys(item).sort()).toEqual(["id","name"]);
  const encoded=JSON.stringify(labels);
  for(const secret of ["readyCents","protected","balanceCents","bankEvidence","sourceHash"])
   expect(encoded).not.toContain(secret);
 });
 it("blocks customer financial access at the transaction rather than only in the navigation",async()=>{
  await expect(getBudgetContext(customer)).rejects.toThrow(/access/);
  await expect(getBudgetPlanning(staff)).rejects.toThrow(/access/);
  await expect(getBudgetPlanning(customer)).rejects.toThrow(/access/);
 });
 it("denies an archived staff actor rather than leaking old labels",async()=>{
  await prisma.user.update({where:{id:staff},data:{archivedAt:new Date()}});
  try{await expect(getBudgetContext(staff)).rejects.toThrow(/access/);}
  finally{await prisma.user.update({where:{id:staff},data:{archivedAt:null}});}
 });
});
