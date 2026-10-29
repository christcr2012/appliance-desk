import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * AR-10b (FINAL-SWEEP 5.1): every exported server action in a file that starts
 * with "use server" must either call a session guard itself (directly or
 * through a same-file helper) or be listed in
 * tests/fixtures/server-action-auth.json with the domain guard or public
 * reason that protects it and an existing test that proves the refusal.
 * A new action with neither fails here.
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

const appRoot = path.join(process.cwd(), "src/app");
const fixturePath = path.join(process.cwd(), "tests/fixtures/server-action-auth.json");

type FixtureEntry = {
  file: string;
  name: string;
  guardedBy: string;
  reason: string;
  test: string;
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function startsWithUseServer(sf: ts.SourceFile): boolean {
  const first = sf.statements[0];
  return (
    !!first &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use server"
  );
}

function callNames(text: string): Set<string> {
  const names = new Set<string>();
  const re = /([A-Za-z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) names.add(m[1]);
  return names;
}

/** Exported action name -> whether a guard is reachable from its body. */
function analyzeFile(file: string): Map<string, boolean> {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const bodies = new Map<string, string>();
  const exported = new Set<string>();
  const isExported = (node: ts.Node) =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    );

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      bodies.set(stmt.name.text, src.slice(stmt.getStart(sf), stmt.end));
      if (isExported(stmt)) exported.add(stmt.name.text);
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          bodies.set(decl.name.text, src.slice(decl.getStart(sf), decl.end));
          if (isExported(stmt)) exported.add(decl.name.text);
        }
      }
    } else if (
      ts.isExportDeclaration(stmt) &&
      stmt.exportClause &&
      ts.isNamedExports(stmt.exportClause)
    ) {
      for (const el of stmt.exportClause.elements) exported.add(el.name.text);
    }
  }

  const result = new Map<string, boolean>();
  for (const name of exported) {
    const body = bodies.get(name);
    if (!body) {
      result.set(name, false);
      continue;
    }
    const seen = new Set<string>([name]);
    const queue = [body];
    let guarded = false;
    while (queue.length && !guarded) {
      const calls = callNames(queue.shift()!);
      for (const guard of GUARDS) {
        if (calls.has(guard)) {
          guarded = true;
          break;
        }
      }
      if (guarded) break;
      for (const callee of calls) {
        if (!seen.has(callee) && bodies.has(callee)) {
          seen.add(callee);
          queue.push(bodies.get(callee)!);
        }
      }
    }
    result.set(name, guarded);
  }
  return result;
}

describe("AR-10b server action auth inventory", () => {
  const files = walk(appRoot).filter((file) =>
    startsWithUseServer(
      ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true),
    ),
  );
  const fixture: FixtureEntry[] = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const fixtureKey = (e: { file: string; name: string }) => `${e.file}::${e.name}`;

  const unguarded: { file: string; name: string }[] = [];
  let total = 0;
  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    for (const [name, guarded] of analyzeFile(file)) {
      total++;
      if (!guarded) unguarded.push({ file: rel, name });
    }
  }

  it("scans a sane number of server actions (parser break cannot pass silently)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(total).toBeGreaterThan(400);
  });

  it("every action without a direct guard is listed in the fixture", () => {
    const listed = new Set(fixture.map(fixtureKey));
    const missing = unguarded.filter((a) => !listed.has(fixtureKey(a)));
    expect(
      missing,
      `Unguarded actions missing from tests/fixtures/server-action-auth.json: ${JSON.stringify(missing, null, 2)}`,
    ).toEqual([]);
  });

  it("every fixture entry still matches a real unguarded action (no stale blessings)", () => {
    const actual = new Set(unguarded.map(fixtureKey));
    const stale = fixture.filter((e) => !actual.has(fixtureKey(e)));
    expect(
      stale,
      `Fixture entries that no longer match an unguarded action: ${JSON.stringify(stale, null, 2)}`,
    ).toEqual([]);
  });

  it("every fixture entry names its guard, a real reason, and an existing refusal test", () => {
    for (const entry of fixture) {
      expect(entry.guardedBy.length, `${fixtureKey(entry)} guardedBy`).toBeGreaterThan(2);
      expect(entry.reason.length, `${fixtureKey(entry)} reason`).toBeGreaterThanOrEqual(15);
      expect(
        fs.existsSync(path.join(process.cwd(), entry.test)),
        `${fixtureKey(entry)} test file ${entry.test} must exist`,
      ).toBe(true);
    }
  });
});
