import type { SiteLinkTarget } from "./types";

/**
 * V-C1: what a website link may point at. Typed in only as one of four things, never as a free address:
 * a known page of this site (with an optional anchor), an https address, or the business's own phone or email.
 */

/** The public pages a link may open. City pages are `/rent/<city>`; the city must be in the service area when it is shown. */
export const SITE_PAGE_PATHS: ReadonlyArray<string> = [
  "/",
  "/pricing",
  "/how-it-works",
  "/service-area",
  "/contact",
  "/launch",
  "/privacy",
  "/terms",
  "/accessibility",
];

const CITY_PATH = /^\/rent\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ANCHOR = /^[a-z][a-z0-9-]{0,40}$/;

export type LinkCheck = { ok: true; target: SiteLinkTarget } | { ok: false; message: string };

/** Keeps the address only if it is a clean https address with no sign-in details, tricks or hidden parts. */
export function checkExternalUrl(raw: string): { ok: true; url: string } | { ok: false; message: string } {
  const text = raw.trim();
  if (!text) return { ok: false, message: "Enter the web address this link opens." };
  if (text.length > 500) return { ok: false, message: "That web address is too long." };
  if (/[\u0000-\u001f\u007f\s<>"'`\\]/.test(text)) return { ok: false, message: "That web address has characters a link cannot contain." };
  if (text.startsWith("//")) return { ok: false, message: "Start the web address with https://" };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, message: "That does not look like a web address. It must start with https://" };
  }
  if (url.protocol !== "https:") return { ok: false, message: "A link to another website must start with https://" };
  if (url.username || url.password) return { ok: false, message: "A web address cannot contain a sign-in name or password." };
  if (!url.hostname || !url.hostname.includes(".")) return { ok: false, message: "That web address needs a website name, such as example.com." };
  return { ok: true, url: url.toString() };
}

/** Validates a link target from untrusted input and returns the cleaned target. */
export function parseLinkTarget(input: unknown): LinkCheck {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, message: "Choose where the link goes." };
  const raw = input as Record<string, unknown>;
  switch (raw.type) {
    case "page": {
      if (typeof raw.path !== "string") return { ok: false, message: "Choose a page for the link." };
      const path = raw.path;
      if (!SITE_PAGE_PATHS.includes(path) && !CITY_PATH.test(path)) return { ok: false, message: "That page is not part of the website." };
      if (raw.anchor === undefined || raw.anchor === "") return { ok: true, target: { type: "page", path } };
      if (typeof raw.anchor !== "string" || !ANCHOR.test(raw.anchor)) return { ok: false, message: "That section name is not allowed." };
      return { ok: true, target: { type: "page", path, anchor: raw.anchor } };
    }
    case "external": {
      if (typeof raw.url !== "string") return { ok: false, message: "Enter the web address this link opens." };
      const checked = checkExternalUrl(raw.url);
      return checked.ok ? { ok: true, target: { type: "external", url: checked.url } } : checked;
    }
    case "phone":
      return { ok: true, target: { type: "phone" } };
    case "email":
      return { ok: true, target: { type: "email" } };
    default:
      return { ok: false, message: "Choose where the link goes." };
  }
}

/** Safe `rel` for a link: other websites never get to see where the visitor came from or control the page. */
export function linkRel(target: SiteLinkTarget): string | undefined {
  return target.type === "external" ? "noopener noreferrer" : undefined;
}

/**
 * The real address for a target. Phone and email come from the verified business profile (Settings), so a link
 * can never send a visitor to a number or address the business did not publish. Returns null when the profile has none.
 */
export function resolveLinkHref(target: SiteLinkTarget, profile: { phone: string | null; email: string | null }): string | null {
  switch (target.type) {
    case "page":
      return target.anchor ? `${target.path}#${target.anchor}` : target.path;
    case "external":
      return target.url;
    case "phone": {
      const digits = profile.phone?.replace(/[^\d+]/g, "") ?? "";
      return digits.length >= 7 ? `tel:${digits}` : null;
    }
    case "email": {
      const email = profile.email?.trim() ?? "";
      return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email) ? `mailto:${email}` : null;
    }
  }
}
