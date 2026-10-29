import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * AR-10b (FINAL-SWEEP 5.2): every desk page either calls a session guard
 * itself or relies only on domain reads that call one. Layouts never count
 * (they do not re-run on navigation — the PR #594 lesson). Pages that rely
 * on their reads are listed in tests/fixtures/desk-page-reads.json with the
 * exact data reads they use; the guard behind each read is re-verified here
 * from the read's own source, and a page that gains a new data read fails
 * until it is guarded and listed. Pure in-memory helpers (no database
 * access anywhere in their call closure) are not reads.
 */

const GUARDS = [
  "requireRole",
  "requireSession",
  "requireAllowedRole",
  "requireRoleForTwoFactorSetup",
  "getServerSession",
  "assertActiveTeamActor",
  "lockAgreementForActor",
];

const root = process.cwd();
const deskRoot = path.join(root, "src/app/desk");
const fixturePath = path.join(root, "tests/fixtures/desk-page-reads.json");

type FixtureEntry = { page: string; reads: { name: string; guard: string }[]; reason?: string };

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name === "page.tsx") out.push(full);
  }
  return out;
}

function callNames(text: string): Set<string> {
  const names = new Set<string>();
  const re = /([A-Za-z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) names.add(m[1]);
  return names;
}

function parse(file: string): { src: string; sf: ts.SourceFile } {
  const src = fs.readFileSync(file, "utf8");
  return { src, sf: ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true) };
}

function localBodies(file: string): Map<string, string> {
  const { src, sf } = parse(file);
  const bodies = new Map<string, string>();
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      bodies.set(stmt.name.text, src.slice(stmt.getStart(sf), stmt.end));
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) bodies.set(decl.name.text, src.slice(decl.getStart(sf), decl.end));
      }
    }
  }
  return bodies;
}

function importsOf(file: string): Map<string, string> {
  const { sf } = parse(file);
  const imports = new Map<string, string>();
  for (const stmt of sf.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.importClause?.namedBindings &&
      ts.isNamedImports(stmt.importClause.namedBindings)
    ) {
      for (const el of stmt.importClause.namedBindings.elements) {
        imports.set(el.name.text, stmt.moduleSpecifier.text);
      }
    }
  }
  return imports;
}

function resolveModule(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(root, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const cand of [base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx"), base]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

/** Find the file that actually defines `name`, chasing re-exports. */
function definitionFile(file: string, name: string, depth = 0): string | null {
  if (depth > 4) return null;
  if (localBodies(file).has(name)) return file;
  const { src, sf } = parse(file);
  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const target = resolveModule(stmt.moduleSpecifier.text, file);
      if (target && definitionFile(target, name, depth + 1)) return definitionFile(target, name, depth + 1);
    }
  }
  void src;
  return null;
}

type Classification = { guarded: boolean; data: boolean; guard: string | null };
const classCache = new Map<string, Classification>();

function classify(file: string, name: string, visiting = new Set<string>()): Classification {
  const key = `${file}::${name}`;
  if (classCache.has(key)) return classCache.get(key)!;
  if (visiting.has(key)) return { guarded: false, data: false, guard: null };
  visiting.add(key);
  const bodies = localBodies(file);
  const body = bodies.get(name);
  if (!body) return { guarded: false, data: false, guard: null };
  const imports = importsOf(file);
  const seen = new Set<string>([name]);
  const queue = [body];
  let guard: string | null = null;
  let data = /prisma\./.test(body);
  while (queue.length) {
    const text = queue.shift()!;
    const calls = callNames(text);
    // The guard nearest the read itself wins: requireRole internally calls
    // requireSession, and the fixture names the guard the read calls.
    if (!guard) for (const g of GUARDS) if (calls.has(g)) guard = g;
    if (/prisma\./.test(text)) data = true;
    for (const callee of calls) {
      if (!seen.has(callee) && bodies.has(callee)) {
        seen.add(callee);
        queue.push(bodies.get(callee)!);
      } else if (!seen.has(callee) && imports.has(callee)) {
        seen.add(callee);
        const target = resolveModule(imports.get(callee)!, file);
        const defFile = target ? definitionFile(target, callee) : null;
        if (defFile) {
          const sub = classify(defFile, callee, visiting);
          if (!guard && sub.guard) guard = sub.guard;
          if (sub.data) data = true;
        }
      }
    }
  }
  const result = { guarded: guard !== null, data, guard };
  classCache.set(key, result);
  return result;
}

function pageCallsOwnGuard(file: string): boolean {
  const bodies = localBodies(file);
  for (const [, body] of bodies) {
    const seen = new Set<string>();
    const queue = [body];
    while (queue.length) {
      const calls = callNames(queue.shift()!);
      for (const g of GUARDS) if (calls.has(g)) return true;
      for (const callee of calls) {
        if (!seen.has(callee) && bodies.has(callee)) {
          seen.add(callee);
          queue.push(bodies.get(callee)!);
        }
      }
    }
  }
  return false;
}

/** Data reads a page relies on: name -> verified guard (or null when unguarded). */
function pageDataReads(file: string): Map<string, string | null> {
  const { src } = parse(file);
  const imports = importsOf(file);
  const reads = new Map<string, string | null>();
  for (const [name, spec] of imports) {
    if (!(spec.startsWith("@/domains") || spec.startsWith(".") || spec.startsWith("@/lib"))) continue;
    if (spec.startsWith("@/lib") && !spec.includes("data") && !spec.includes("reads")) continue;
    if (!new RegExp(`\\b${name}\\s*\\(`).test(src)) continue;
    const target = resolveModule(spec, file);
    if (!target) continue;
    const defFile = definitionFile(target, name);
    if (!defFile) continue;
    const c = classify(defFile, name);
    if (!c.data) continue; // pure helper — not a read
    reads.set(name, c.guard);
  }
  return reads;
}

describe("AR-10b desk page auth inventory", () => {
  const pages = walk(deskRoot);
  const fixture: FixtureEntry[] = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const fixtureByPage = new Map(fixture.map((e) => [e.page, e]));

  it("scans every desk page", () => {
    expect(pages.length).toBeGreaterThan(150);
  });

  it("every page guards itself or relies only on guarded data reads", () => {
    const problems: string[] = [];
    for (const page of pages) {
      const rel = path.relative(root, page);
      if (pageCallsOwnGuard(page)) {
        if (fixtureByPage.has(rel)) problems.push(`${rel}: guards itself but is also in the fixture (stale entry)`);
        continue;
      }
      const { src } = parse(page);
      if (/from "@\/lib\/prisma"/.test(src)) {
        problems.push(`${rel}: queries prisma directly with no guard of its own`);
        continue;
      }
      const reads = pageDataReads(page);
      const entry = fixtureByPage.get(rel);
      if (!entry) {
        problems.push(`${rel}: no own guard and no fixture entry`);
        continue;
      }
      const listed = new Map(entry.reads.map((r) => [r.name, r.guard]));
      for (const [name, guard] of reads) {
        if (guard === null) problems.push(`${rel}: data read ${name} has no guard in its closure`);
        else if (!listed.has(name)) problems.push(`${rel}: data read ${name} is not listed in the fixture`);
        else if (listed.get(name) !== guard)
          problems.push(`${rel}: fixture says ${name} is guarded by ${listed.get(name)}, source says ${guard}`);
      }
      for (const name of listed.keys()) {
        if (!reads.has(name)) problems.push(`${rel}: fixture lists ${name}, which the page no longer reads (stale)`);
      }
      if (reads.size === 0 && !(entry.reason && entry.reason.length >= 15)) {
        problems.push(`${rel}: reads no data, so its fixture entry needs a reason of 15+ characters`);
      }
    }
    for (const entry of fixture) {
      if (!fs.existsSync(path.join(root, entry.page))) problems.push(`${entry.page}: fixture entry for a missing page`);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
