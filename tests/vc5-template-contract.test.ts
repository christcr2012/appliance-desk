import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeOrThrow } from "@/domains/site-content/codec";
import { SITE_FIELDS, SITE_PLACEHOLDERS, siteDefaults, siteFieldSpec } from "@/domains/site-content/fields";
import {
  CONTENT_SLOTS, CONTRACT_FINGERPRINT, DOMAIN_SLOTS, LAST_SUPPORTED_CONTENT_SCHEMA, STRUCTURE_SLOTS, SUPPORTED_CONTENT_SCHEMAS,
  TEMPLATE_CONTRACT_VERSION, contractFingerprint, planCompatibility, type ContentSlot,
} from "@/domains/site-content/template-contract";
import { SITE_TEMPLATE_VERSION, type SiteValue } from "@/domains/site-content/types";

const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/site-content/${name}.json`, "utf8")) as { contentSchemaVersion: number; fields: Record<string, unknown> };

describe("V-C5 template contract matches the editor", () => {
  it("lists exactly the editor's items, with the same kind, length limit and optional state", () => {
    const fromEditor = new Map(SITE_FIELDS.map((f) => { const s = siteFieldSpec(f.key)!; return [s.key, [s.valueKind, s.rules.maxLength, s.optional] as const]; }));
    const fromContract = new Map(CONTENT_SLOTS.map((s) => [s[0], [s[1], s[2], s[3] === true] as const]));
    const missingFromContract = [...fromEditor.keys()].filter((k) => !fromContract.has(k));
    const missingFromEditor = [...fromContract.keys()].filter((k) => !fromEditor.has(k));
    expect(missingFromContract, "editor items the layout contract does not list").toEqual([]);
    expect(missingFromEditor, "contract slots the editor no longer has").toEqual([]);
    for (const [key, shape] of fromEditor) expect(fromContract.get(key), key).toEqual(shape);
    expect(CONTENT_SLOTS.length).toBe(new Set(CONTENT_SLOTS.map((s) => s[0])).size);
  });

  it("gives every slot exactly one owner: the editor, one other part of the product, or nobody (structure)", () => {
    const ids = [...CONTENT_SLOTS.map((s) => `content:${s[0]}`), ...DOMAIN_SLOTS.map((s) => `domain:${s.id}`), ...STRUCTURE_SLOTS.map((s) => `structure:${s.id}`)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const slot of DOMAIN_SLOTS) {
      expect(slot.owner.length, slot.id).toBeGreaterThan(3);
      expect(slot.note.length, slot.id).toBeGreaterThan(3);
    }
    // No business fact is typed into the website: each {placeholder} the editor allows belongs to exactly one other owner.
    for (const placeholder of SITE_PLACEHOLDERS) {
      expect(DOMAIN_SLOTS.filter((s) => s.placeholder === placeholder).length, placeholder).toBe(1);
    }
    expect(DOMAIN_SLOTS.filter((s) => s.placeholder).every((s) => (SITE_PLACEHOLDERS as readonly string[]).includes(s.placeholder!))).toBe(true);
  });

  it("is versioned with the layout and cannot change without the version and fingerprint being updated on purpose", () => {
    expect(TEMPLATE_CONTRACT_VERSION).toBe(SITE_TEMPLATE_VERSION);
    expect(contractFingerprint(), "A slot changed. Update CONTRACT_FINGERPRINT, and bump SITE_TEMPLATE_VERSION if the layout changed, then add the carry-over to docs/runbooks/WEBSITE-TEMPLATE-ROLLBACK.md").toBe(CONTRACT_FINGERPRINT);
    const changed: ContentSlot[] = [...CONTENT_SLOTS.slice(1)];
    expect(contractFingerprint(changed)).not.toBe(CONTRACT_FINGERPRINT);
  });
});

describe("V-C5 release rule: the layout can show every supported saved content format", () => {
  it("supports the formats it claims, including the oldest", () => {
    expect(SUPPORTED_CONTENT_SCHEMAS).toContain(LAST_SUPPORTED_CONTENT_SCHEMA);
    expect(Math.min(...SUPPORTED_CONTENT_SCHEMAS)).toBe(LAST_SUPPORTED_CONTENT_SCHEMA);
  });

  for (const version of [1, 2] as const) {
    it(`reads the saved example of content format ${version} and every item resolves to something the layout can show`, () => {
      const saved = fixture(`schema-v${version}`);
      expect(saved.contentSchemaVersion).toBe(version);
      expect(SUPPORTED_CONTENT_SCHEMAS).toContain(version);
      const decoded = decodeOrThrow(version, saved.fields);
      expect(decoded.problems).toEqual([]);
      const defaults = siteDefaults();
      for (const slot of CONTENT_SLOTS) {
        const value = decoded.values[slot[0]];
        if (value) {
          if (value.kind !== "hidden") expect(value.kind, slot[0]).toBe(slot[1]);
        } else if (slot[1] === "text") {
          expect(typeof defaults[slot[0]], `${slot[0]} needs starting words`).toBe("string");
        }
      }
      // A key the layout no longer knows is kept aside, never shown.
      if (version === 1) expect(Object.keys(decoded.retired)).toEqual(["retired.example.key"]);
    });
  }
});

describe("V-C5 carrying the owner's content across a layout change and back", () => {
  const v2 = decodeOrThrow(2, fixture("schema-v2").fields).values;
  const now = { version: TEMPLATE_CONTRACT_VERSION, slots: CONTENT_SLOTS };

  it("keeps everything when nothing changed", () => {
    const report = planCompatibility(now, now, v2);
    expect(report.values).toEqual(v2);
    expect(report.retired).toEqual([]);
    expect(report.blocking).toEqual([]);
    expect(report.newRequired).toEqual([]);
  });

  it("reports retired, renamed and new items, keeps retired content aside, and never invents content over written content", () => {
    const next = {
      version: "classic-2",
      slots: [
        ...CONTENT_SLOTS.filter((s) => s[0] !== "how.intro" && s[0] !== "home.hero.heading"),
        ["how.lead", "text", 2000] as ContentSlot,
        ["home.new.required", "text", 200] as ContentSlot,
      ],
    };
    const report = planCompatibility(now, next, v2, { "how.intro": "how.lead" });
    expect(report.renamed).toEqual([{ from: "how.intro", to: "how.lead" }]);
    expect(report.values["how.lead"]).toEqual(v2["how.intro"]);
    expect(report.retired).toEqual(["home.hero.heading"]);
    expect(report.preserved["home.hero.heading"]).toEqual(v2["home.hero.heading"]);
    expect(report.newRequired).toEqual(["home.new.required"]);
    expect(report.values["home.new.required"]).toBeUndefined();
    // Nothing stored was edited by planning.
    expect(v2["how.intro"]).toEqual({ kind: "text", text: "Our own words for how it works. Ask {businessName} anything." });
  });

  it("survives a change and a rollback with the owner's content unchanged", () => {
    const next = { version: "classic-2", slots: [...CONTENT_SLOTS.filter((s) => s[0] !== "home.hero.heading" && s[0] !== "how.intro"), ["how.lead", "text", 2000] as ContentSlot] };
    const there = planCompatibility(now, next, v2, { "how.intro": "how.lead" });
    const back = planCompatibility(next, now, { ...there.values, ...there.preserved }, { "how.lead": "how.intro" });
    expect(back.values).toEqual(v2);
    expect(back.blocking).toEqual([]);
  });

  it("stops and asks a person when a kind no longer matches, instead of converting content", () => {
    const next = { version: "classic-2", slots: CONTENT_SLOTS.map((s) => (s[0] === "header.cta.live" ? (["header.cta.live", "text", 120] as ContentSlot) : s)) };
    const report = planCompatibility(now, next, v2);
    expect(report.blocking).toEqual([{ key: "header.cta.live", was: "link", needs: "text" }]);
    expect(report.values["header.cta.live"]).toBeUndefined();
    expect(report.preserved["header.cta.live"]).toEqual(v2["header.cta.live"] as SiteValue);
  });
});
