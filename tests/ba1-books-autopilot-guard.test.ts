import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BOOK_RETIREMENT_INTENT, PLAN_CHOICES } from "@/domains/inventory/retired-plans";

function sourceFiles(dir:string):string[]{
 return readdirSync(dir,{withFileTypes:true}).flatMap(item=>{
  const name=join(dir,item.name);
  return item.isDirectory()?sourceFiles(name):/\.(ts|tsx)$/.test(name)?[name]:[];
 });
}

describe("BA-1 books writer boundaries",()=>{
 it("never exposes a trusted automatic/equipment writer in a public app route or server action",()=>{
  for(const path of sourceFiles(join(process.cwd(),"src/app"))){
   const content=readFileSync(path,"utf8");
   expect(content, path).not.toMatch(/kind:\s*["']automatic["']/);
   expect(content, path).not.toMatch(/kind:\s*["']equipment["']/);
  }
 });
 it("maps every supported retired-appliance plan choice",()=>{
  const choices=PLAN_CHOICES.map(c=>c.value).sort();
  expect(Object.keys(BOOK_RETIREMENT_INTENT).sort()).toEqual(choices);
  expect(Object.values(BOOK_RETIREMENT_INTENT)).toEqual(
   expect.arrayContaining(["SELL","STRIP","SCRAP","DISPOSE","DONATE_OTHER"]));
 });
});
