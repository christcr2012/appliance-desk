import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * AR-10b (FINAL-SWEEP 5.3): every API route handler must be protected by a
 * session guard, the cron secret check, a provider signature check, or a
 * token/key check — in the route file itself or in a helper it calls.
 * Anything else must be listed in tests/fixtures/api-route-auth.json as
 * public with a reason. A new unguarded route fails here.
 */

const SESSION_GUARDS = [
  "requireRole",
  "requireSession",
  "requireAllowedRole",
  "requireRoleForTwoFactorSetup",
  "getServerSession",
  "assertActiveTeamActor",
];
const CRON_CHECKS = ["cronAuthorized"];
const SIGNATURE_CHECKS = ["constructEvent", "validateRequest", "verifyVoiceRequest"];
const TOKEN_CHECKS = ["authorizeOpsRequest", "authenticateMcpRequest"];

const root = process.cwd();
const apiRoot = path.join(root, "src/app/api");
const fixturePath = path.join(root, "tests/fixtures/api-route-auth.json");

type FixtureEntry = { file: string; reason: string };
type Mechanism = "session" | "cron" | "signature" | "token" | null;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name === "route.ts") out.push(full);
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

function definitionFile(file: string, name: string, depth = 0): string | null {
  if (depth > 4) return null;
  if (localBodies(file).has(name)) return file;
  const { sf } = parse(file);
  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const target = resolveModule(stmt.moduleSpecifier.text, file);
      if (target) {
        const found = definitionFile(target, name, depth + 1);
        if (found) return found;
      }
    }
  }
  return null;
}

const mechCache = new Map<string, Mechanism>();

function mechanismOf(file: string, name: string, visiting = new Set<string>()): Mechanism {
  const key = `${file}::${name}`;
  if (mechCache.has(key)) return mechCache.get(key)!;
  if (visiting.has(key)) return null;
  visiting.add(key);
  const bodies = localBodies(file);
  const body = bodies.get(name);
  if (!body) return null;
  const imports = importsOf(file);
  const seen = new Set<string>([name]);
  const queue = [body];
  let mech: Mechanism = null;
  const consider = (text: string) => {
    const calls = callNames(text);
    if (!mech && SESSION_GUARDS.some((g) => calls.has(g))) mech = "session";
    if (!mech && CRON_CHECKS.some((g) => calls.has(g))) mech = "cron";
    if (!mech && SIGNATURE_CHECKS.some((g) => calls.has(g))) mech = "signature";
    if (!mech && (text.includes("webhooks.verify") || text.includes("svix-signature"))) mech = "signature";
    if (!mech && TOKEN_CHECKS.some((g) => calls.has(g))) mech = "token";
    return calls;
  };
  while (queue.length) {
    const calls = consider(queue.shift()!);
    for (const callee of calls) {
      if (seen.has(callee)) continue;
      seen.add(callee);
      if (bodies.has(callee)) queue.push(bodies.get(callee)!);
      else if (imports.has(callee)) {
        const target = resolveModule(imports.get(callee)!, file);
        const defFile = target ? definitionFile(target, callee) : null;
        if (defFile && !mech) {
          const sub = mechanismOf(defFile, callee, visiting);
          if (sub) mech = sub;
        }
      }
    }
  }
  mechCache.set(key, mech);
  return mech;
}

function routeMechanism(file: string): Mechanism {
  const { sf } = parse(file);
  const bodies = localBodies(file);
  const handlers = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "handle"];
  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      // e.g. export { handle as GET } — analyze the local source name.
      for (const el of stmt.exportClause.elements) {
        const local = (el.propertyName ?? el.name).text;
        if (bodies.has(local)) {
          const mech = mechanismOf(file, local);
          if (mech) return mech;
        }
      }
    }
  }
  for (const name of handlers) {
    if (bodies.has(name)) {
      const mech = mechanismOf(file, name);
      if (mech) return mech;
    }
  }
  return null;
}

describe("AR-10b API route auth inventory", () => {
  const routes = walk(apiRoot);
  const fixture: FixtureEntry[] = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const publicFiles = new Set(fixture.map((e) => e.file));

  it("scans every API route", () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it("every route has a protection mechanism or a reasoned public listing", () => {
    const problems: string[] = [];
    for (const route of routes) {
      const rel = path.relative(root, route);
      const mech = routeMechanism(route);
      if (mech) {
        if (publicFiles.has(rel)) problems.push(`${rel}: protected (${mech}) but also listed public (stale entry)`);
      } else if (!publicFiles.has(rel)) {
        problems.push(`${rel}: no session/cron/signature/token protection found and not listed public`);
      }
    }
    for (const entry of fixture) {
      expect(entry.reason.length, `${entry.file} reason`).toBeGreaterThanOrEqual(15);
      if (!fs.existsSync(path.join(root, entry.file))) problems.push(`${entry.file}: fixture entry for a missing route`);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
