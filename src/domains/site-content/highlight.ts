import { MARK_ANY } from "./preview-markers";

/**
 * The one highlighted phrase in a heading. The owner types the phrase; it counts only when it is an exact part of the
 * heading (so a typo or an edited heading never produces a stray highlight). Invisible preview marks are ignored.
 */
export function splitHighlight(heading: string, phrase: string): { before: string; match: string; after: string } | null {
  const wanted = phrase.replace(MARK_ANY, "").trim();
  if (!wanted) return null;
  const at = heading.indexOf(wanted);
  if (at < 0) return null;
  return { before: heading.slice(0, at), match: wanted, after: heading.slice(at + wanted.length) };
}
