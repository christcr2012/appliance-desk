#!/usr/bin/env node
/**
 * The October 13 owner answer count is a subject-level reconciliation, not
 * 56 new approved PRs. Fail if an answer silently loses its roadmap home
 * or if proposed work is marked equivalent to implemented/current.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function validateOwnerDecisionRouting(coverage, work, fileExists = path => existsSync(resolve(root,path))) {
  const errors = [];
  const count = coverage?.entries?.length ?? -1;
  if (coverage?.version !== 1) errors.push("Invalid owner routing version");
  // This marker is a reviewed, committed roadmap transition, not a
  // permanent W-23 fixture. Future approved successors advance this source
  // document deliberately rather than weakening the roadmap lock.
  const allowedOrdered = ["W-23", "W-24", "W-25", "W-26", "W-14", "W-3", "W-5", "W-7", "W-8", "W-10"];
  if (!allowedOrdered.includes(coverage?.activeExecutionMustRemain))
    errors.push("Owner decision map has no approved active W successor");
  if (work?.activeExecution !== coverage?.activeExecutionMustRemain)
    errors.push("Active work changed; review roadmap sequencing and update owner decision map deliberately");
  const expected = {pricing:22, delivery:5, property:6, communications:11, accounting:12};
  if (JSON.stringify(coverage?.expectedGroupCounts) !== JSON.stringify(expected))
    errors.push("Owner answer source group counts changed without a reviewed map update");
  if (count !== 56) errors.push("Expected exactly 56 reconciled source subjects, got "+count);
  const ids = new Set(), targets = new Set((work?.cards ?? []).map(c=>c.id));
  const byGroup = Object.fromEntries(Object.keys(expected).map(k=>[k,0]));
  if (!fileExists(coverage?.source ?? "")) errors.push("Owner decision source missing");
  if (!fileExists("docs/designs/OWNER-DECISIONS-2026-10-13-ENGINEERING.md")) errors.push("Engineering contract missing");
  for (const entry of coverage?.entries ?? []) {
    if (!entry?.id || ids.has(entry.id)) errors.push("Duplicate/invalid owner subject "+entry?.id);
    ids.add(entry?.id);
    if (!Object.hasOwn(byGroup, entry?.group)) errors.push("Unknown decision category "+entry?.id);
    else byGroup[entry.group]++;
    for (const name of ["subject","ownerInput","decision","acceptance","activationGate"]) {
      if (typeof entry?.[name] !== "string" || entry[name].trim().length < (name === "ownerInput" ? 4 : 8))
        errors.push(entry?.id+" missing useful "+name);
    }
    if (!targets.has(entry?.target)) errors.push(entry?.id+" maps to missing roadmap card "+entry?.target);
    if (entry?.classification !== "DESIGN_COVERAGE_ONLY")
      errors.push(entry?.id+" incorrectly asserts implementation/approval from an owner response");
  }
  for (const [g,n] of Object.entries(expected))
    if (byGroup[g]!==n) errors.push(g+" should have "+n+" decision subjects, got "+byGroup[g]);
  const contract=(work?.cards ?? []).filter(c=>coverage?.entries?.some(e=>e.target===c.id));
  for (const c of contract) {
    if (!fileExists(c.card ?? "")) errors.push("Mapped card does not exist: "+c.id);
  }
  const idx=(coverage?.entries ?? []).find(e=>e.ownerInput==="IN-84");
  if (!idx || idx.target!=="W-5" || !/five calendar days/i.test(idx.decision) || !/\$5/.test(idx.decision))
    errors.push("Later IN-84 five-day + $5 decision missing from route");
  const proposed=(coverage?.entries ?? []).filter(e=>["BP-1","K-CASH-2","K-CASH-6"].includes(e.target));
  if (!proposed.length) errors.push("Deferred/proposed decisions must not disappear");
  return errors;
}
export function check() {
  const coverage=JSON.parse(readFileSync(resolve(root,"docs/owner-decisions/2026-10-13-implementation-map.json"),"utf8"));
  const work=JSON.parse(readFileSync(resolve(root,"docs/pr-cards/work-index.json"),"utf8"));
  const errors=validateOwnerDecisionRouting(coverage,work);
  if (errors.length) { for (const e of errors) console.error("Owner decision map: "+e);process.exitCode=1; }
  else console.log("PASS: 56 answered owner decision subjects mapped to existing ordered roadmap; no implementation/LIVE proof asserted");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) check();

