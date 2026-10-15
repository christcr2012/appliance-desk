import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateOwnerDecisionRouting } from "./check-owner-decisions.mjs";
const root=resolve(import.meta.dirname,"..");
const coverage=JSON.parse(readFileSync(resolve(root,"docs/owner-decisions/2026-10-13-implementation-map.json"),"utf8"));
const work=JSON.parse(readFileSync(resolve(root,"docs/pr-cards/work-index.json"),"utf8"));
test("October 13 source subjects all map to actual approved or explicitly proposed roadmap positions",()=>{
 assert.deepEqual(validateOwnerDecisionRouting(coverage,work),[]);
});
test("cannot silently reclassify approved owner decisions or move backward to W-22FIN after merged W-22 engineering",()=>{
 const changed=structuredClone(coverage);changed.entries[0].classification="ENGINEERING_COMPLETE";
 assert.match(validateOwnerDecisionRouting(changed,work).join(" "),/asserts implementation/);
 const wrongWork=structuredClone(work);wrongWork.activeExecution="W-22FIN";
 assert.match(validateOwnerDecisionRouting(coverage,wrongWork).join(" "),/Active work changed/);
});
test("missing CPA/late policy mapping, duplicate subjects and invented targets fail",()=>{
 const changed=structuredClone(coverage);
 const item=changed.entries.find(e=>e.ownerInput==="IN-84");item.decision="Unspecified late fee";
 changed.entries[0].target="W-999";
 changed.entries[1].id=changed.entries[0].id;
 const errors=validateOwnerDecisionRouting(changed,work).join(" ");
 assert.match(errors,/five-day/);
 assert.match(errors,/missing roadmap card/);
 assert.match(errors,/Duplicate/);
});

