import { checkExternalUrl, SITE_PAGE_PATHS } from "./links";
import type { SiteLinkTarget } from "./types";

/**
 * V-C3: the one piece of formatting website paragraphs may carry: a link inside a sentence, written
 * `[words to click](/pricing)` or `[words](https://example.com)`. Nothing else is interpreted: no HTML, no emphasis,
 * no images. Only fields marked `links` treat this as a link; elsewhere the brackets are just text.
 */

export type RichSegment =
  | { type: "text"; text: string }
  | { type: "link"; label: string; target: SiteLinkTarget };

const INLINE = /\[([^\[\]\n]{1,80})\]\(([^()\s]{1,500})\)/g;
const CITY_PATH = /^\/rent\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ANCHOR = /^[a-z][a-z0-9-]{0,40}$/;

export function parseInlineTarget(raw: string): { ok: true; target: SiteLinkTarget } | { ok: false; message: string } {
  if (raw.startsWith("/")) {
    const [path, anchor, ...rest] = raw.split("#");
    if (rest.length) return { ok: false, message: "That page link is not allowed." };
    if (!SITE_PAGE_PATHS.includes(path) && !CITY_PATH.test(path)) return { ok: false, message: "That page is not part of the website." };
    if (anchor === undefined) return { ok: true, target: { type: "page", path } };
    if (!ANCHOR.test(anchor)) return { ok: false, message: "That section name is not allowed." };
    return { ok: true, target: { type: "page", path, anchor } };
  }
  const checked = checkExternalUrl(raw);
  return checked.ok ? { ok: true, target: { type: "external", url: checked.url } } : checked;
}

/** Checks every link written in the text. Returns a plain message for the first bad one, or null. */
export function checkInlineLinks(text: string): string | null {
  // Anything that looks like a link but is not written exactly as [words](address) is refused, never silently kept.
  const looksLikeLinks = (text.match(/\]\(/g) ?? []).length;
  if (looksLikeLinks !== [...text.matchAll(INLINE)].length) {
    return "A link is not written correctly. Use [words to click](/page) or [words to click](https://address), with no spaces or brackets inside.";
  }
  for (const match of text.matchAll(INLINE)) {
    const checked = parseInlineTarget(match[2]);
    if (!checked.ok) return `The link "${match[1]}" does not work: ${checked.message}`;
  }
  return null;
}

export function parseRichText(text: string, links: boolean): RichSegment[] {
  if (!links) return text ? [{ type: "text", text }] : [];
  const out: RichSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const checked = parseInlineTarget(match[2]);
    if (!checked.ok) continue; // a bad link shows as the words it was typed with, never as a live link
    if (match.index > last) out.push({ type: "text", text: text.slice(last, match.index) });
    out.push({ type: "link", label: match[1], target: checked.target });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

/** The words with link marks removed (for page titles, descriptions and search). */
export function stripInlineLinks(text: string): string {
  return text.replace(INLINE, "$1");
}
