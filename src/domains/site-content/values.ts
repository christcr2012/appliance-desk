import { parseLinkTarget } from "./links";
import type { FieldValueKind, ImageValue, ItemsValue, LinkValue, PromotionValue, SiteValue, TextValue } from "./types";

/**
 * V-C1: checks one typed value against what its field allows. Pure: the rules come in as a field description,
 * so tests can use any field. Plain text only (angle brackets removed), bounded, and every problem says what to fix.
 */

export type ValueRules = {
  label: string;
  valueKind: FieldValueKind;
  /** An optional field may be intentionally empty or hidden. A required field may not. */
  optional: boolean;
  /** Longest text, in characters. */
  maxLength: number;
  /** Longest list. */
  maxItems?: number;
  /** For `items`: the value rules of each part of one list entry. */
  itemFields?: Readonly<Record<string, ValueRules>>;
  /** For `text`: the text must stay on one line. */
  singleLine?: boolean;
  /** For `text`: the text is a web address and must start with https://. */
  httpsOnly?: boolean;
  /** For `text`: the only {placeholders} the text may contain. Others would show up as typed. */
  placeholders?: ReadonlyArray<string>;
};

export type ValueCheck = { ok: true; value: SiteValue } | { ok: false; message: string };

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const ASSET_ID = /^[A-Za-z0-9_-]{8,64}$/;
const ITEM_ID = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_ALT = 160;

export function cleanPlainText(raw: string, singleLine: boolean): string {
  const text = raw.replace(/[<>]/g, "").replace(/\r\n?/g, "\n");
  return (singleLine ? text.replace(/\s*\n\s*/g, " ") : text).trim();
}

const fail = (message: string): ValueCheck => ({ ok: false, message });

function validInstant(value: unknown): value is string {
  return typeof value === "string" && ISO_UTC.test(value) && !Number.isNaN(Date.parse(value));
}

function focus(label: string, n: unknown): string | null {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 100 ? null : `${label}: the picture's focus point must be a whole number from 0 to 100.`;
}

function checkText(rules: ValueRules, v: Record<string, unknown>): ValueCheck {
  if (typeof v.text !== "string") return fail(`${rules.label} must be text.`);
  const text = cleanPlainText(v.text, rules.singleLine ?? true);
  if (!text && !rules.optional) return fail(`${rules.label} cannot be empty. Use the recommended text instead.`);
  if (text.length > rules.maxLength) return fail(`${rules.label} is too long: ${rules.maxLength} characters at most.`);
  if (text && rules.httpsOnly && !text.startsWith("https://")) return fail(`${rules.label} must start with https://`);
  if (rules.placeholders) {
    for (const match of text.matchAll(/\{(\w+)\}/g)) {
      if (!rules.placeholders.includes(match[1])) return fail(`${rules.label} uses {${match[1]}}, which is not available here.`);
    }
  }
  return { ok: true, value: { kind: "text", text } satisfies TextValue };
}

function checkLink(rules: ValueRules, v: Record<string, unknown>): ValueCheck {
  if (typeof v.label !== "string") return fail(`${rules.label}: the link needs words to click.`);
  const label = cleanPlainText(v.label, true);
  if (!label) return fail(`${rules.label}: the link needs words to click.`);
  if (label.length > Math.min(rules.maxLength, 120)) return fail(`${rules.label}: the link words are too long.`);
  const target = parseLinkTarget(v.target);
  if (!target.ok) return fail(`${rules.label}: ${target.message}`);
  return { ok: true, value: { kind: "link", label, target: target.target } satisfies LinkValue };
}

function checkImage(rules: ValueRules, v: Record<string, unknown>): ValueCheck {
  if (typeof v.assetId !== "string" || !ASSET_ID.test(v.assetId)) return fail(`${rules.label}: choose a picture from your photo library.`);
  if (typeof v.decorative !== "boolean") return fail(`${rules.label}: say whether the picture is only decoration.`);
  const problem = focus(rules.label, v.focalX) ?? focus(rules.label, v.focalY);
  if (problem) return fail(problem);
  const alt = typeof v.alt === "string" ? cleanPlainText(v.alt, true) : "";
  if (!v.decorative && !alt) return fail(`${rules.label}: describe the picture for people who cannot see it, or mark it as decoration.`);
  if (alt.length > MAX_ALT) return fail(`${rules.label}: the picture description is too long: ${MAX_ALT} characters at most.`);
  return {
    ok: true,
    value: { kind: "image", assetId: v.assetId, alt: v.decorative ? "" : alt, decorative: v.decorative, focalX: v.focalX as number, focalY: v.focalY as number } satisfies ImageValue,
  };
}

function checkItems(rules: ValueRules, v: Record<string, unknown>, depth: number): ValueCheck {
  if (depth > 0) return fail(`${rules.label}: lists cannot hold other lists.`);
  if (!Array.isArray(v.items)) return fail(`${rules.label} must be a list.`);
  const max = rules.maxItems ?? 12;
  if (v.items.length > max) return fail(`${rules.label} has too many entries: ${max} at most.`);
  if (!rules.itemFields) return fail(`${rules.label} is not set up to hold a list.`);
  const seen = new Set<string>();
  const items: ItemsValue["items"] = [];
  for (const entry of v.items) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return fail(`${rules.label}: one entry could not be read.`);
    const { id, values } = entry as { id?: unknown; values?: unknown };
    if (typeof id !== "string" || !ITEM_ID.test(id) || seen.has(id)) return fail(`${rules.label}: an entry has a missing or repeated id.`);
    seen.add(id);
    if (!values || typeof values !== "object" || Array.isArray(values)) return fail(`${rules.label}: one entry could not be read.`);
    const clean: Record<string, SiteValue> = {};
    for (const [part, partRules] of Object.entries(rules.itemFields)) {
      const raw = (values as Record<string, unknown>)[part];
      if (raw === undefined) {
        if (partRules.optional) continue;
        return fail(`${rules.label}: ${partRules.label} is missing from an entry.`);
      }
      const checked = validateSiteValue(partRules, raw, depth + 1);
      if (!checked.ok) return checked;
      clean[part] = checked.value;
    }
    for (const part of Object.keys(values as object)) {
      if (!(part in rules.itemFields)) return fail(`${rules.label}: an entry has a part that is not allowed.`);
    }
    items.push({ id, values: clean });
  }
  return { ok: true, value: { kind: "items", items } satisfies ItemsValue };
}

function checkPromotion(rules: ValueRules, v: Record<string, unknown>): ValueCheck {
  if (typeof v.enabled !== "boolean") return fail(`${rules.label}: say whether the promotion is switched on.`);
  const title = typeof v.title === "string" ? cleanPlainText(v.title, true) : "";
  const body = typeof v.body === "string" ? cleanPlainText(v.body, false) : "";
  if (!title) return fail(`${rules.label}: the promotion needs a title.`);
  if (title.length > 120) return fail(`${rules.label}: the promotion title is too long: 120 characters at most.`);
  if (body.length > rules.maxLength) return fail(`${rules.label}: the promotion text is too long: ${rules.maxLength} characters at most.`);
  for (const [name, text] of [["starts", v.startsAtUtc], ["ends", v.endsAtUtc]] as const) {
    if (text !== undefined && !validInstant(text)) return fail(`${rules.label}: the date it ${name} could not be read.`);
  }
  const starts = v.startsAtUtc as string | undefined;
  const ends = v.endsAtUtc as string | undefined;
  if (starts && ends && Date.parse(ends) <= Date.parse(starts)) return fail(`${rules.label}: the promotion must end after it starts.`);
  const out: PromotionValue = { kind: "promotion", title, body, enabled: v.enabled };
  if (starts) out.startsAtUtc = starts;
  if (ends) out.endsAtUtc = ends;
  if (v.offerVersionId !== undefined) {
    if (typeof v.offerVersionId !== "string" || !ITEM_ID.test(v.offerVersionId)) return fail(`${rules.label}: the linked offer could not be read.`);
    out.offerVersionId = v.offerVersionId;
  }
  if (v.image !== undefined) {
    const image = checkImage(rules, v.image as Record<string, unknown>);
    if (!image.ok) return image;
    out.image = image.value as ImageValue;
  }
  if (v.cta !== undefined) {
    const cta = checkLink(rules, v.cta as Record<string, unknown>);
    if (!cta.ok) return cta;
    out.cta = cta.value as LinkValue;
  }
  return { ok: true, value: out };
}

/** The only door for a typed value. `depth` is 0 at the top of a field and 1 inside one list entry. */
export function validateSiteValue(rules: ValueRules, raw: unknown, depth = 0): ValueCheck {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail(`${rules.label} could not be read.`);
  const v = raw as Record<string, unknown>;
  if (v.kind === "hidden") {
    return rules.optional ? { ok: true, value: { kind: "hidden" } } : fail(`${rules.label} cannot be hidden.`);
  }
  if (v.kind !== rules.valueKind) {
    return fail(`${rules.label} holds the wrong kind of content (it needs ${rules.valueKind === "items" ? "a list" : rules.valueKind}).`);
  }
  switch (rules.valueKind) {
    case "text":
      return checkText(rules, v);
    case "link":
      return checkLink(rules, v);
    case "image":
      return checkImage(rules, v);
    case "items":
      return checkItems(rules, v, depth);
    case "promotion":
      return checkPromotion(rules, v);
  }
}
