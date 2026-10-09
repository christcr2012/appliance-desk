import { businessDateKey, businessDateFromKey } from "@/lib/business-date";

/**
 * The public-profile extras (docs/archive/designs-completed/BATCH-D.md D2): opening hours, holiday closures, social links, logo.
 * Pure logic (no database). The stored shapes:
 *   hours:            { mon: { closed: true } | { open: "09:00", close: "17:00" }, ... }  (a day that is not listed is not shown)
 *   holidayClosures:  [{ date: "YYYY-MM-DD", label: "Christmas Day" }]                    (at most 30)
 *   socialLinks:      { facebook?: "https://...", instagram?, google?, nextdoor? }
 *   logoUrl:          "https://..." or one of the files in public/brand, or null
 */

export const DAYS = [
  { id: "mon", label: "Monday" },
  { id: "tue", label: "Tuesday" },
  { id: "wed", label: "Wednesday" },
  { id: "thu", label: "Thursday" },
  { id: "fri", label: "Friday" },
  { id: "sat", label: "Saturday" },
  { id: "sun", label: "Sunday" },
] as const;
export type DayId = (typeof DAYS)[number]["id"];

export const SOCIAL_NETWORKS = [
  { id: "facebook", label: "Facebook" },
  { id: "instagram", label: "Instagram" },
  { id: "google", label: "Google Business Profile" },
  { id: "nextdoor", label: "Nextdoor" },
] as const;
export type SocialId = (typeof SOCIAL_NETWORKS)[number]["id"];

export const BRAND_LOGO_FILES = ["/brand/logo-light.svg", "/brand/logo-dark.svg", "/brand/mark.svg"] as const;
export const MAX_CLOSURES = 30;

export type HoursMode = "none" | "closed" | "open";
export type HoursFormDay = { mode: HoursMode; open: string; close: string };
export type StoredHours = Partial<Record<DayId, { closed: true } | { open: string; close: string }>>;
export type Closure = { date: string; label: string };
export type StoredSocial = Partial<Record<SocialId, string>>;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export type ProfileExtrasForm = {
  hours: Record<DayId, HoursFormDay>;
  holidayClosuresText: string;
  facebookUrl: string;
  instagramUrl: string;
  googleUrl: string;
  nextdoorUrl: string;
  logoUrl: string;
};

export const PROFILE_EXTRAS_KEYS = [
  "hours",
  "holidayClosuresText",
  "facebookUrl",
  "instagramUrl",
  "googleUrl",
  "nextdoorUrl",
  "logoUrl",
] as const;

/* ---------- reading what is stored (defensively) ---------- */

export function parseStoredHours(raw: unknown): StoredHours {
  const out: StoredHours = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const { id } of DAYS) {
    const v = (raw as Record<string, unknown>)[id] as Record<string, unknown> | undefined;
    if (!v || typeof v !== "object") continue;
    if (v.closed === true) out[id] = { closed: true };
    else if (typeof v.open === "string" && typeof v.close === "string" && TIME.test(v.open) && TIME.test(v.close) && v.open < v.close) {
      out[id] = { open: v.open, close: v.close };
    }
  }
  return out;
}

export function parseStoredClosures(raw: unknown): Closure[] {
  if (!Array.isArray(raw)) return [];
  const out: Closure[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { date, label } = item as Record<string, unknown>;
    if (typeof date === "string" && typeof label === "string" && businessDateFromKey(date) && label.trim()) {
      out.push({ date, label: label.trim() });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, MAX_CLOSURES);
}

export function parseStoredSocial(raw: unknown): StoredSocial {
  const out: StoredSocial = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const { id } of SOCIAL_NETWORKS) {
    const v = (raw as Record<string, unknown>)[id];
    if (typeof v === "string" && isHttps(v)) out[id] = v;
  }
  return out;
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:" && value.startsWith("https://");
  } catch {
    return false;
  }
}

/**
 * A logo address that is safe to put in a page: one of our own brand files, or an https address in this app's own
 * file storage (the only outside host the site's security policy lets a picture load from). Design D2 said "any
 * https address"; the site blocks pictures from other hosts, so those would silently not show (CHANGES-SINCE-DESIGN).
 */
export function safeLogoUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if ((BRAND_LOGO_FILES as readonly string[]).includes(value)) return value;
  if (!isHttps(value)) return null;
  const host = new URL(value).hostname;
  return host.endsWith(".public.blob.vercel-storage.com") ? value : null;
}

/* ---------- the form ---------- */

export function profileExtrasDefaults(row: {
  hours?: unknown;
  holidayClosures?: unknown;
  socialLinks?: unknown;
  logoUrl?: string | null;
}): ProfileExtrasForm {
  const stored = parseStoredHours(row.hours);
  const hours = Object.fromEntries(
    DAYS.map(({ id }) => {
      const d = stored[id];
      const day: HoursFormDay = !d
        ? { mode: "none", open: "09:00", close: "17:00" }
        : "closed" in d
          ? { mode: "closed", open: "09:00", close: "17:00" }
          : { mode: "open", open: d.open, close: d.close };
      return [id, day];
    }),
  ) as Record<DayId, HoursFormDay>;
  const social = parseStoredSocial(row.socialLinks);
  return {
    hours,
    holidayClosuresText: parseStoredClosures(row.holidayClosures)
      .map((c) => `${c.date} ${c.label}`)
      .join("\n"),
    facebookUrl: social.facebook ?? "",
    instagramUrl: social.instagram ?? "",
    googleUrl: social.google ?? "",
    nextdoorUrl: social.nextdoor ?? "",
    logoUrl: safeLogoUrl(row.logoUrl) ?? "",
  };
}

export type ExtrasUpdate = {
  hours: StoredHours;
  holidayClosures: Closure[];
  socialLinks: StoredSocial;
  logoUrl: string | null;
};

/** Check what the owner typed and turn it into the stored shapes. */
export function profileExtrasUpdate(
  raw: Record<string, unknown>,
): { success: true; update: ExtrasUpdate } | { success: false; message: string } {
  // Hours
  const hoursRaw = raw.hours;
  if (!hoursRaw || typeof hoursRaw !== "object" || Array.isArray(hoursRaw)) {
    return { success: false, message: "Check the opening hours." };
  }
  const hours: StoredHours = {};
  for (const { id, label } of DAYS) {
    const d = (hoursRaw as Record<string, unknown>)[id] as Record<string, unknown> | undefined;
    if (!d || typeof d !== "object") return { success: false, message: `Check the opening hours for ${label}.` };
    if (d.mode === "none") continue;
    if (d.mode === "closed") {
      hours[id] = { closed: true };
      continue;
    }
    if (d.mode !== "open") return { success: false, message: `Check the opening hours for ${label}.` };
    const open = typeof d.open === "string" ? d.open : "";
    const close = typeof d.close === "string" ? d.close : "";
    if (!TIME.test(open) || !TIME.test(close)) {
      return { success: false, message: `${label}: enter opening and closing times such as 09:00 and 17:00.` };
    }
    if (open >= close) return { success: false, message: `${label}: closing time must be later than opening time.` };
    hours[id] = { open, close };
  }

  // Closures: one per line, "YYYY-MM-DD Name"
  const text = typeof raw.holidayClosuresText === "string" ? raw.holidayClosuresText : null;
  if (text === null) return { success: false, message: "Check the holiday closures." };
  const closures: Closure[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const match = /^(\d{4}-\d{2}-\d{2})\s+(.+)$/.exec(line);
    if (!match || !businessDateFromKey(match[1])) {
      return { success: false, message: `Holiday closures: "${line.slice(0, 40)}" should look like 2026-12-25 Christmas Day.` };
    }
    const label = match[2].replace(/[<>]/g, "").trim();
    if (!label || label.length > 60) return { success: false, message: "Holiday closure names can be up to 60 characters." };
    if (seen.has(match[1])) return { success: false, message: `Holiday closures: ${match[1]} is listed twice.` };
    seen.add(match[1]);
    closures.push({ date: match[1], label });
  }
  if (closures.length > MAX_CLOSURES) {
    return { success: false, message: `You can list up to ${MAX_CLOSURES} closures. Remove the ones that have passed.` };
  }
  closures.sort((a, b) => a.date.localeCompare(b.date));

  // Social links
  const social: StoredSocial = {};
  const keys: Record<SocialId, string> = {
    facebook: "facebookUrl",
    instagram: "instagramUrl",
    google: "googleUrl",
    nextdoor: "nextdoorUrl",
  };
  for (const { id, label } of SOCIAL_NETWORKS) {
    const v = raw[keys[id]];
    if (typeof v !== "string") return { success: false, message: `Check the ${label} link.` };
    const value = v.trim();
    if (!value) continue;
    if (value.length > 300 || !isHttps(value)) {
      return { success: false, message: `${label} link must be a full web address starting with https://` };
    }
    social[id] = value;
  }

  // Logo
  const logoRaw = raw.logoUrl;
  if (typeof logoRaw !== "string") return { success: false, message: "Check the logo address." };
  const logo = logoRaw.trim();
  let logoUrl: string | null = null;
  if (logo) {
    logoUrl = safeLogoUrl(logo);
    if (!logoUrl || logo.length > 500) {
      return {
        success: false,
        message:
          "The logo must be a picture uploaded to your own file storage (an https address ending .public.blob.vercel-storage.com) or one of: " +
          BRAND_LOGO_FILES.join(", "),
      };
    }
  }

  return { success: true, update: { hours, holidayClosures: closures, socialLinks: social, logoUrl } };
}

/* ---------- showing it to the public ---------- */

function clock(value: string): string {
  const [h, m] = value.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** One line per run of days that share the same hours: "Mon–Fri: 9 am – 5 pm". Days not listed are omitted. */
export function hoursLines(raw: unknown): string[] {
  const stored = parseStoredHours(raw);
  const lines: string[] = [];
  let i = 0;
  while (i < DAYS.length) {
    const d = stored[DAYS[i].id];
    if (!d) {
      i += 1;
      continue;
    }
    const text = "closed" in d ? "Closed" : `${clock(d.open)} – ${clock(d.close)}`;
    let j = i;
    while (j + 1 < DAYS.length) {
      const next = stored[DAYS[j + 1].id];
      const nextText = !next ? null : "closed" in next ? "Closed" : `${clock(next.open)} – ${clock(next.close)}`;
      if (nextText !== text) break;
      j += 1;
    }
    const short = (n: number) => DAYS[n].label.slice(0, 3);
    lines.push(`${i === j ? short(i) : `${short(i)}–${short(j)}`}: ${text}`);
    i = j + 1;
  }
  return lines;
}

/** Closures that have not passed yet (Colorado date), soonest first, e.g. "Dec 25, 2026 — Christmas Day". */
export function upcomingClosures(raw: unknown, now = new Date()): { date: string; text: string }[] {
  const today = businessDateKey(now);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return parseStoredClosures(raw)
    .filter((c) => c.date >= today)
    .map((c) => {
      const [y, m, d] = c.date.split("-").map(Number);
      return { date: c.date, text: `${months[m - 1]} ${d}, ${y} — ${c.label}` };
    });
}

export function socialLinkList(raw: unknown): { id: SocialId; label: string; url: string }[] {
  const stored = parseStoredSocial(raw);
  return SOCIAL_NETWORKS.filter((n) => stored[n.id]).map((n) => ({ id: n.id, label: n.label, url: stored[n.id]! }));
}
