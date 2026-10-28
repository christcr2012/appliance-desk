// AR-8 (SETTINGS spec sections 4 + 8): the settings catalog covers the
// whole BusinessSettings model — every field is an editable row, is named
// in a panel/link row's covers list, or is NOT_A_SETTING with a reason —
// and the catalog's own promises hold: explanations everywhere, panel/link
// hrefs are real routes, the old section ids map, and recommended values
// match the schema defaults unless a decision owns the value.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALL_SETTING_ROWS,
  NOT_A_SETTING,
  OLD_SECTION_REDIRECTS,
  SETTINGS_SECTIONS_V2,
  coveredSettingFields,
} from "@/domains/settings/catalog";

const ROOT = process.cwd();

function businessSettingsFields(): Map<string, string | null> {
  const schema = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8");
  const block = schema.match(/model BusinessSettings \{([\s\S]*?)\n\}/)?.[1];
  if (!block) throw new Error("BusinessSettings model not found");
  const fields = new Map<string, string | null>();
  for (const line of block.split("\n")) {
    const m = line.match(/^\s+([a-z][a-zA-Z0-9]*)\s+\S+/);
    if (!m) continue;
    const def = line.match(/@default\((.*)\)\s*$/)?.[1] ?? null;
    fields.set(m[1], def);
  }
  return fields;
}

describe("catalog coverage", () => {
  it("accounts for every BusinessSettings field exactly once", () => {
    const fields = businessSettingsFields();
    const covered = coveredSettingFields();
    const missing: string[] = [];
    for (const field of fields.keys()) {
      if (!covered.has(field) && !(field in NOT_A_SETTING)) missing.push(field);
    }
    expect(missing).toEqual([]);
    // And nothing in NOT_A_SETTING is also covered (a field has one home).
    for (const field of Object.keys(NOT_A_SETTING)) {
      expect(fields.has(field)).toBe(true);
      expect(covered.has(field)).toBe(false);
    }
  });

  it("has unique row keys and every row explains itself", () => {
    const keys = ALL_SETTING_ROWS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of ALL_SETTING_ROWS) {
      expect(r.what.length, r.key).toBeGreaterThan(0);
      expect(r.label.length, r.key).toBeGreaterThan(0);
      if (r.kind !== "panel" && r.kind !== "link" && r.kind !== "text") {
        expect(r.recommended, `${r.key} recommended`).not.toBeUndefined();
        expect(r.why, `${r.key} why`).toBeTruthy();
      }
      expect(SETTINGS_SECTIONS_V2.map((s) => s.id)).toContain(r.section);
    }
  });

  it("panel and link hrefs are real route files", () => {
    for (const r of ALL_SETTING_ROWS) {
      if (typeof r.editor === "object" && "panelHref" in r.editor) {
        const href = r.editor.panelHref;
        const page = href === "/" ? join(ROOT, "src/app/(public)/page.tsx") : join(ROOT, "src/app", href, "page.tsx");
        expect(existsSync(page), `${r.key} -> ${href}`).toBe(true);
      }
    }
  });

  it("old section ids redirect to real sections", () => {
    const ids = SETTINGS_SECTIONS_V2.map((s) => s.id);
    for (const [oldId, target] of Object.entries(OLD_SECTION_REDIRECTS)) {
      expect(ids, oldId).toContain(target);
    }
    expect(OLD_SECTION_REDIRECTS["policies"]).toBe("rentals");
    expect(OLD_SECTION_REDIRECTS["security"]).toBe("team");
  });

  it("recommended values equal the schema defaults unless a decision owns them", () => {
    const fields = businessSettingsFields();
    for (const r of ALL_SETTING_ROWS) {
      if (r.decisionId || r.recommended === undefined) continue;
      if (r.editor !== "row" && !(typeof r.editor === "object" && "domainWriter" in r.editor)) continue;
      const def = fields.get(r.key);
      if (def === null || def === undefined) continue;
      if (typeof r.recommended === "number") {
        expect(Number(def), r.key).toBe(r.recommended);
      } else if (typeof r.recommended === "boolean") {
        expect(def, r.key).toBe(String(r.recommended));
      } else if (typeof r.recommended === "object") {
        expect(JSON.parse(def.replace(/^"|"$/g, "").replace(/\\"/g, '"')), r.key).toEqual(r.recommended);
      }
    }
  });
});
