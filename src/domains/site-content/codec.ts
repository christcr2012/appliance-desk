import { canonicalSiteKey, siteFieldSpec } from "./fields";
import {
  CONTENT_SCHEMA_VERSION_TEXT,
  CONTENT_SCHEMA_VERSION_TYPED,
  SiteContentError,
  type ContentSchemaVersion,
  type SiteValue,
} from "./types";
import { cleanPlainText, validateSiteValue, type ValueRules } from "./values";

/**
 * V-C1: reads and writes a revision's stored content in either format (docs/designs/BATCH-V.md D-VC1).
 *  - version 1: `{ key: "text" }` — the original format. An empty string means "not set": the page shows the starting text.
 *  - version 2: `{ key: SiteValue }` — typed values. An empty text is an intentional choice (only for optional fields);
 *    `{kind:"hidden"}` is an explicit hide.
 * Missing = the field's starting value. Unknown or retired keys are kept in history but never shown.
 * Pure: the field lookup is passed in so tests can use any registry.
 */

export type FieldLookup = (key: string) => { rules: ValueRules } | undefined;

export const registryLookup: FieldLookup = (key) => {
  const spec = siteFieldSpec(canonicalSiteKey(key));
  return spec ? { rules: spec.rules } : undefined;
};

export type DecodedContent = {
  /** Known, valid values by today's key. */
  values: Record<string, SiteValue>;
  /** Stored keys this version of the site does not know. Kept as they were; never rendered. */
  retired: Record<string, unknown>;
  /** Known fields whose stored value cannot be read as what the field expects. */
  problems: { key: string; message: string }[];
};

export function isSchemaVersion(version: number): version is ContentSchemaVersion {
  return version === CONTENT_SCHEMA_VERSION_TEXT || version === CONTENT_SCHEMA_VERSION_TYPED;
}

export function decodeContentRevision(version: number, stored: unknown, lookup: FieldLookup = registryLookup): DecodedContent {
  if (!isSchemaVersion(version)) {
    throw new SiteContentError(`This website version was saved in a format (${version}) that this site cannot read yet.`);
  }
  const out: DecodedContent = { values: {}, retired: {}, problems: [] };
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return out;
  for (const [rawKey, raw] of Object.entries(stored as Record<string, unknown>)) {
    const key = canonicalSiteKey(rawKey);
    const field = lookup(key);
    if (!field) {
      out.retired[rawKey] = raw;
      continue;
    }
    if (version === CONTENT_SCHEMA_VERSION_TEXT) {
      // Plain text: only non-empty strings were ever meaningful. Anything else is ignored as it always was.
      if (typeof raw === "string" && raw.trim() && field.rules.valueKind === "text") {
        out.values[key] = { kind: "text", text: raw };
      }
      continue;
    }
    const checked = validateSiteValue(field.rules, raw);
    if (checked.ok) out.values[key] = checked.value;
    else out.problems.push({ key, message: checked.message });
  }
  return out;
}

/** Reads a revision for display: any problem is an explicit error, never text such as [object Object]. */
export function decodeOrThrow(version: number, stored: unknown, lookup: FieldLookup = registryLookup): DecodedContent {
  const decoded = decodeContentRevision(version, stored, lookup);
  const first = decoded.problems[0];
  if (first) throw new SiteContentError(`${first.message} (field ${first.key})`, first.key);
  return decoded;
}

export type EncodeResult = { ok: true; stored: Record<string, SiteValue> } | { ok: false; message: string; key?: string };

/**
 * Checks values the owner is saving and prepares them for storage (version 2). Unknown keys are refused rather than
 * silently dropped, and every value must pass its field's rules.
 */
export function encodeContentValues(input: unknown, lookup: FieldLookup = registryLookup): EncodeResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, message: "Those website changes could not be read." };
  const stored: Record<string, SiteValue> = {};
  for (const [rawKey, raw] of Object.entries(input as Record<string, unknown>)) {
    const key = canonicalSiteKey(rawKey);
    const field = lookup(key);
    if (!field) return { ok: false, message: "One of those fields is not something you can change.", key: rawKey };
    const checked = validateSiteValue(field.rules, raw);
    if (!checked.ok) return { ok: false, message: checked.message, key };
    stored[key] = checked.value;
  }
  return { ok: true, stored };
}

/**
 * Turns the text the editor has always sent (`{key: "text"}`) into version 2 values. An empty text means "not set"
 * (the field keeps its starting text), exactly as before; choosing "hide" or "intentionally empty" needs typed values.
 */
export function legacyTextToValues(fields: Record<string, string>): Record<string, SiteValue> {
  const out: Record<string, SiteValue> = {};
  for (const [key, text] of Object.entries(fields)) {
    if (typeof text === "string" && text.trim()) out[key] = { kind: "text", text: cleanPlainText(text, false) };
  }
  return out;
}

/** The plain text a text-only reader sees for one value: "" for hidden and for an intentionally empty text. */
export function valueToPlainText(value: SiteValue | undefined): string | undefined {
  if (!value) return undefined;
  if (value.kind === "text") return value.text;
  if (value.kind === "hidden") return "";
  return undefined;
}

/** Every picture a set of values refers to (including inside a list or a promotion), so publishing can check them. */
export function collectAssetIds(values: Record<string, SiteValue>): string[] {
  const ids = new Set<string>();
  const walk = (value: SiteValue | undefined) => {
    if (!value) return;
    if (value.kind === "image") ids.add(value.assetId);
    else if (value.kind === "promotion" && value.image) ids.add(value.image.assetId);
    else if (value.kind === "items") for (const item of value.items) for (const part of Object.values(item.values)) walk(part);
  };
  for (const value of Object.values(values)) walk(value);
  return [...ids].sort();
}
