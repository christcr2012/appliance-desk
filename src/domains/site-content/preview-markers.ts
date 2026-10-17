import { SITE_FIELDS } from "./fields";
import type { SiteValue } from "./types";

/**
 * V-C4: "Select this content to edit". Only the owner's signed-in preview (`?select=1`) wraps website words in invisible
 * private-use characters that carry the item's position in the registry. A small script in that preview reads them,
 * removes them from the page and reports a click on the words. The public site never creates them.
 */
const START = "";
const MID = "";
const END = "";
const DIGIT0 = 0xe010;

export const MARK_PATTERN = /([-]+)([\s\S]*?)/g;
export const MARK_ANY = /[--]/g;

const INDEX = new Map(SITE_FIELDS.map((f, i) => [f.key, i]));
export const SITE_KEYS: ReadonlyArray<string> = SITE_FIELDS.map((f) => f.key);

function encodeIndex(i: number): string {
  return [...String(i)].map((d) => String.fromCharCode(DIGIT0 + Number(d))).join("");
}
function decodeIndex(s: string): number {
  return Number([...s].map((c) => c.charCodeAt(0) - DIGIT0).join(""));
}

export function markText(key: string, text: string): string {
  const i = INDEX.get(key);
  if (i === undefined || !text) return text;
  return `${START}${encodeIndex(i)}${MID}${text}${END}`;
}

/** The words with every mark removed, and the keys they carried, in order. */
export function readMarks(text: string): { text: string; keys: string[] } {
  const keys: string[] = [];
  const plain = text.replace(MARK_PATTERN, (_all, digits: string, inner: string) => {
    const key = SITE_KEYS[decodeIndex(digits)];
    if (key) keys.push(key);
    return inner;
  });
  return { text: plain.replace(MARK_ANY, ""), keys };
}

/** Marks every word and button label of a preview so a click can be traced back to its item. */
export function markContent(text: Record<string, string>, values: Record<string, SiteValue>): { text: Record<string, string>; values: Record<string, SiteValue> } {
  const markedText: Record<string, string> = {};
  for (const [key, value] of Object.entries(text)) markedText[key] = markText(key, value);
  const markedValues: Record<string, SiteValue> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value.kind === "link") markedValues[key] = { ...value, label: markText(key, value.label) };
    else if (value.kind === "promotion") {
      markedValues[key] = {
        ...value,
        title: markText(key, value.title),
        body: markText(key, value.body),
        ...(value.cta ? { cta: { ...value.cta, label: markText(key, value.cta.label) } } : {}),
      };
    } else markedValues[key] = value;
  }
  return { text: markedText, values: markedValues };
}
