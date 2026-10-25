// AR-0 kit guards (docs/build-specs/KIT.md section 9). They run on every page listed in
// docs/build-specs/migrated-pages.json (each AR card adds its pages; AR-10 makes it every desk page), and rule 5 runs
// on all of src/. tests/fixtures/kit-guard-bad-page.tsx breaks each rule once to prove every rule really fails.
//
// migrated-pages.json entries are route files: "src/app/desk/billing/page.tsx", or
// { "file": "…", "kind": "list" | "record" | "other" } when the page type cannot be told from the file. Without a kind,
// a path with a dynamic segment ([id]) is a record page, a page that renders <ScreenHeader is a list page, and any
// other page has no import rule.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { visibleText } from "../scripts/check-owner-wording.mjs";

type PageKind = "list" | "record" | "other";
type PageEntry = string | { file: string; kind: PageKind };
type AllowEntry = { file: string; rule: 3; reason: string };
type Violation = { rule: 1 | 2 | 3 | 4 | 5; line: number; message: string };

export const MAX_TEXT = 140;
const KIT_IMPORT = "@/components/kit";

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/** Each JSX opening tag of these components, from "<Name" to its closing ">" (braces and strings respected). */
function openingTags(source: string, names: string[]): { index: number; text: string }[] {
  const found: { index: number; text: string }[] = [];
  const start = new RegExp(`<(?:${names.join("|")})\\b`, "g");
  for (const match of source.matchAll(start)) {
    let depth = 0;
    let quote: string | null = null;
    let end = match.index! + match[0].length;
    for (; end < source.length; end++) {
      const ch = source[end];
      if (quote) {
        if (ch === quote && source[end - 1] !== "\\") quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    found.push({ index: match.index!, text: source.slice(match.index!, end + 1) });
  }
  return found;
}

/** Rule 1: no description= prop on ScreenHeader / PageHeader. */
export function ruleNoHeaderDescription(source: string): Violation[] {
  return openingTags(source, ["ScreenHeader", "PageHeader"])
    .filter((tag) => /\sdescription\s*=/.test(tag.text))
    .map((tag) => ({ rule: 1 as const, line: lineOf(source, tag.index), message: "page header with a description (put help in an InfoTip)" }));
}

// A line that is only a navigation link with text children (optionally inside its own <li>), e.g.
// `<li><Link href="/a">Open bills</Link></li>`. Text may include {expressions} but no tags (so no kit wrapper).
const BARE_LINK_LINE =
  /^\s*(?:<li\b[^>]*>\s*)?<(Link|a)\b(?:[^>{}]|\{[^{}]*\})*>(?:[^<>{}]|\{[^{}<>]*\})*<\/\1>\s*(?:<\/li>)?\s*$/;

/** Rule 2: no three consecutive sibling lines that are bare navigation links. */
export function ruleNoBareLinkLists(source: string): Violation[] {
  const lines = source.split("\n");
  const out: Violation[] = [];
  let run = 0;
  lines.forEach((line, index) => {
    run = BARE_LINK_LINE.test(line) ? run + 1 : 0;
    if (run === 3) out.push({ rule: 2, line: index - 1, message: "three bare navigation links in a row (use AreaTabs, a DataTable or ActionButtons)" });
  });
  return out;
}

/** Blank out (keeping line numbers) the places where long text is allowed: InfoTip, ConfirmDialog and confirm specs. */
function withoutAllowedLongText(source: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  let out = source;
  for (const name of ["InfoTip", "ConfirmDialog"]) {
    out = out.replace(new RegExp(`<${name}\\b[\\s\\S]*?(?:/>|</${name}>)`, "g"), blank);
  }
  out = out.replace(/\bconfirm\s*[:=]\s*\{\{?[\s\S]*?\}\}?/g, blank);
  return out;
}

/** Rule 3: no visible text longer than 140 characters. */
export function ruleNoLongText(source: string): Violation[] {
  return (visibleText(withoutAllowedLongText(source)) as { line: number; text: string }[])
    .filter(({ text }) => text.trim().replace(/\s+/g, " ").length > MAX_TEXT)
    .map(({ line, text }) => ({ rule: 3 as const, line, message: `visible text of ${text.trim().length} characters (max ${MAX_TEXT})` }));
}

function kitImports(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']@\/components\/kit["']/g)) {
    for (const part of match[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      if (name) names.add(name);
    }
  }
  return names;
}

export function pageKind(entry: PageEntry, source: string): PageKind {
  if (typeof entry !== "string") return entry.kind;
  if (/\[[^\]]+\]/.test(entry)) return "record";
  return /<ScreenHeader\b/.test(source) ? "list" : "other";
}

/** Rule 4: list pages import DataTable and Toolbar from the kit; record pages import RecordHeader. */
export function ruleKitImports(kind: PageKind, source: string): Violation[] {
  const names = kitImports(source);
  const needed = kind === "list" ? ["DataTable", "Toolbar"] : kind === "record" ? ["RecordHeader"] : [];
  return needed
    .filter((name) => !names.has(name))
    .map((name) => ({ rule: 4 as const, line: 1, message: `${kind} page does not import ${name} from ${KIT_IMPORT}` }));
}

const UI_LIBRARY_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["'](@radix-ui\/[^"']+|cmdk|vaul)(?:\/[^"']*)?["']/gm;

/** Rule 5: Radix, cmdk and vaul are imported only inside src/components/kit/. */
export function ruleNoUiLibraryOutsideKit(path: string, source: string): Violation[] {
  if (path.replace(/\\/g, "/").startsWith("src/components/kit/")) return [];
  return [...source.matchAll(UI_LIBRARY_IMPORT)].map((match) => ({
    rule: 5 as const,
    line: lineOf(source, match.index!),
    message: `imports ${match[1]} outside src/components/kit`,
  }));
}

export function checkPage(entry: PageEntry, source: string, allow: AllowEntry[]): Violation[] {
  const file = typeof entry === "string" ? entry : entry.file;
  const allowLongText = allow.some((item) => item.file === file && item.rule === 3);
  return [
    ...ruleNoHeaderDescription(source),
    ...ruleNoBareLinkLists(source),
    ...(allowLongText ? [] : ruleNoLongText(source)),
    ...ruleKitImports(pageKind(entry, source), source),
    ...ruleNoUiLibraryOutsideKit(file, source),
  ];
}

function sourceFiles(folder: string, acc: string[] = []): string[] {
  if (!existsSync(folder)) return acc;
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) sourceFiles(path, acc);
    else if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) acc.push(relative(process.cwd(), path).replace(/\\/g, "/"));
  }
  return acc;
}

const pages = JSON.parse(readFileSync("docs/build-specs/migrated-pages.json", "utf8")) as PageEntry[];
const allowFile = JSON.parse(readFileSync("scripts/kit-guard-allowlist.json", "utf8")) as { entries: AllowEntry[] };
const fixturePath = "tests/fixtures/kit-guard-bad-page.tsx";
const fixture = readFileSync(fixturePath, "utf8");

describe("kit guards on the migrated pages (KIT 9)", () => {
  it("the page list and allow-list have the agreed shape", () => {
    expect(Array.isArray(pages)).toBe(true);
    for (const entry of pages) {
      const file = typeof entry === "string" ? entry : entry.file;
      expect(file, "each entry is a route file under src/app").toMatch(/^src\/app\/.+\/(?:page|layout)\.tsx$/);
      expect(existsSync(file), `${file} exists`).toBe(true);
      if (typeof entry !== "string") expect(["list", "record", "other"]).toContain(entry.kind);
    }
    expect(Array.isArray(allowFile.entries)).toBe(true);
    for (const entry of allowFile.entries) {
      expect(typeof entry.file).toBe("string");
      expect(entry.rule, "only guard 3 (long legal/tax wording) can be allow-listed").toBe(3);
      expect(String(entry.reason ?? "").trim().length, `${entry.file} needs a written reason`).toBeGreaterThanOrEqual(15);
    }
  });

  it.each(pages.length > 0 ? pages : ["(no pages migrated yet)"])("%s passes every guard", (entry) => {
    if (entry === "(no pages migrated yet)") return;
    const file = typeof entry === "string" ? entry : entry.file;
    const violations = checkPage(entry, readFileSync(file, "utf8"), allowFile.entries);
    expect(violations.map((v) => `${file}:${v.line} guard ${v.rule}: ${v.message}`)).toEqual([]);
  });

  it("guard 5: nothing outside src/components/kit imports Radix, cmdk or vaul", () => {
    const violations = sourceFiles("src").flatMap((file) =>
      ruleNoUiLibraryOutsideKit(file, readFileSync(file, "utf8")).map((v) => `${file}:${v.line} ${v.message}`),
    );
    expect(violations).toEqual([]);
  });
});

describe("kit guards fail on a page that breaks them (tests/fixtures/kit-guard-bad-page.tsx)", () => {
  const violations = checkPage(fixturePath, fixture, []);
  const byRule = (rule: number) => violations.filter((violation) => violation.rule === rule);

  it("guard 1: a page header description is refused", () => {
    expect(byRule(1)).toHaveLength(1);
  });

  it("guard 2: three bare navigation links in a row are refused", () => {
    expect(byRule(2)).toHaveLength(1);
  });

  it("guard 3: visible text over 140 characters is refused (unless allow-listed)", () => {
    expect(byRule(3)).toHaveLength(1);
    expect(checkPage(fixturePath, fixture, [{ file: fixturePath, rule: 3, reason: "legal wording test entry" }]).filter((v) => v.rule === 3)).toEqual([]);
  });

  it("guard 4: a list page without DataTable and Toolbar is refused", () => {
    expect(pageKind(fixturePath, fixture)).toBe("list");
    expect(byRule(4).map((violation) => violation.message)).toEqual([
      `list page does not import DataTable from ${KIT_IMPORT}`,
      `list page does not import Toolbar from ${KIT_IMPORT}`,
    ]);
    expect(ruleKitImports("record", fixture)).toHaveLength(1);
    expect(pageKind("src/app/desk/customers/[id]/page.tsx", "")).toBe("record");
  });

  it("guard 5: importing vaul outside the kit is refused", () => {
    expect(byRule(5)).toHaveLength(1);
    expect(ruleNoUiLibraryOutsideKit("src/components/kit/sheet.tsx", fixture)).toEqual([]);
  });
});

describe("kit guard edge cases", () => {
  it("allows long text inside InfoTip, ConfirmDialog and confirm specs", () => {
    const long = "x ".repeat(90);
    expect(ruleNoLongText(`<p>${long}</p>`)).toHaveLength(1);
    expect(ruleNoLongText(`<ConfirmDialog spec={{ title: "T", summary: "${long}", confirmLabel: "Go" }} />`)).toEqual([]);
    expect(ruleNoLongText(`const spec = { kind: "form", confirm: { title: "T", summary: "${long}", confirmLabel: "Go" } };`)).toEqual([]);
  });

  it("does not count a link that wraps a kit component, or two links in a row", () => {
    expect(ruleNoBareLinkLists(['<Link href="/a">A</Link>', '<Link href="/b">B</Link>', "<p>x</p>", '<Link href="/c">C</Link>'].join("\n"))).toEqual([]);
    expect(
      ruleNoBareLinkLists(['<Link href="/a"><ActionButton spec={a} /></Link>', '<Link href="/b">B</Link>', '<Link href="/c">C</Link>'].join("\n")),
    ).toEqual([]);
    expect(ruleNoBareLinkLists(['<a href="/a">A {count}</a>', '<a href="/b">B</a>', '<a href="/c">C</a>'].join("\n"))).toHaveLength(1);
  });

  it("finds a description prop on a header written across several lines", () => {
    expect(ruleNoHeaderDescription('<PageHeader\n  title="Bills"\n  primaryAction={{ href: "/a", label: "A" }}\n  description="x"\n/>')).toHaveLength(1);
    expect(ruleNoHeaderDescription('<ScreenHeader title="Bills" primary={{ kind: "link", label: "New", href: "/n" }} />')).toEqual([]);
  });

  it("reads multi-line and aliased kit imports", () => {
    const source = 'import {\n  DataTable,\n  Toolbar as ListToolbar,\n  type Column,\n} from "@/components/kit";';
    expect(ruleKitImports("list", source)).toEqual([]);
  });
});
