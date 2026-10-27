import { businessDateKey } from "@/lib/business-date";

/**
 * VAULT-2: pure rules for the logins vault (spec RECORDS-VAULT §§4-6). No
 * database, no secrets — masking, rotation dates and the unlock limits.
 */

/** How long one fresh-code unlock lasts (spec §5: 5 minutes). */
export const VAULT_UNLOCK_MINUTES = 5;
/** Failed codes inside the window that lock the vault (spec §5). */
export const VAULT_FAIL_LIMIT = 5;
export const VAULT_FAIL_WINDOW_MINUTES = 15;
/** How long the lock lasts, from the latest failure (spec §5). */
export const VAULT_LOCK_MINUTES = 30;
/** A revealed value hides again after this many seconds (spec §5, client side). */
export const REVEAL_HIDE_SECONDS = 30;

/**
 * Derives the lock from the failure times. Any cluster of VAULT_FAIL_LIMIT
 * failures inside one VAULT_FAIL_WINDOW_MINUTES span locks the vault until
 * VAULT_LOCK_MINUTES after that cluster's latest failure — and the lock
 * lasts its full 30 minutes even after the cluster's earliest failures age
 * out of the counting window, so callers must pass enough history (window
 * + lock minutes' worth). Pure: the caller fetches the audit rows.
 */
export function vaultLockFromFailures(
  failures: readonly Date[],
  now: Date,
): { locked: boolean; lockedUntil: Date | null } {
  const sorted = [...failures].sort((a, b) => b.getTime() - a.getTime());
  let lockedUntil: Date | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const clusterEnd = sorted[i]!.getTime();
    const windowStart = clusterEnd - VAULT_FAIL_WINDOW_MINUTES * 60_000;
    let count = 0;
    for (let j = i; j < sorted.length && sorted[j]!.getTime() > windowStart; j++) count += 1;
    if (count >= VAULT_FAIL_LIMIT) {
      const until = new Date(clusterEnd + VAULT_LOCK_MINUTES * 60_000);
      if (until > now && (!lockedUntil || until > lockedUntil)) lockedUntil = until;
    }
  }
  return lockedUntil ? { locked: true, lockedUntil } : { locked: false, lockedUntil: null };
}

/**
 * Word-wraps text for the emergency-export PDF without ever dropping or
 * changing a character — whitespace included, because a password with two
 * spaces in a row must export with two spaces. Tokens alternate between
 * words and the whitespace runs between them; a line break falls between
 * tokens or inside an over-long token, never over a character, so joining
 * the lines with "" restores the text exactly.
 */
export function wrapPdfText(text: string, maxChars = 105): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const tokens = paragraph.match(/\S+|\s+/g) ?? [""];
    let current = "";
    const pushToken = (token: string) => {
      let rest = token;
      while (rest.length > maxChars) {
        if (current) {
          lines.push(current);
          current = "";
        }
        lines.push(rest.slice(0, maxChars));
        rest = rest.slice(maxChars);
      }
      if (!rest) return;
      if (!current) current = rest;
      else if (current.length + rest.length <= maxChars) current += rest;
      else {
        lines.push(current);
        current = rest;
      }
    };
    for (const token of tokens) pushToken(token);
    lines.push(current);
  }
  return lines;
}

/**
 * The emergency PDF is drawn with the standard Helvetica fonts, which can
 * only print the WinAnsi character set; the PDF library throws on anything
 * else, so one login with an emoji in its password would sink the whole
 * export. Characters outside the set become "?" in the PDF — and only in
 * the PDF: the export's logins.txt carries every value exactly as saved,
 * and the PDF says so whenever a character had to be substituted.
 */
const WINANSI_EXTRA_CODE_POINTS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d,
  0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e,
  0x0178,
]);

export function pdfSafeText(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === "\n" || (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WINANSI_EXTRA_CODE_POINTS.has(cp)) {
      out += ch;
    } else {
      out += "?";
    }
  }
  return out;
}

export const VAULT_FIELDS = ["username", "password", "notes"] as const;
export type VaultField = (typeof VAULT_FIELDS)[number];

export function isVaultField(value: string): value is VaultField {
  return (VAULT_FIELDS as readonly string[]).includes(value);
}

/**
 * How a username shows when the vault is locked or on the list: enough to
 * recognise the account, never enough to use it. "chris@bank.com" becomes
 * "c•••@bank.com"; a plain name keeps its first two characters.
 */
export function maskUsername(plain: string | null | undefined): string | null {
  if (!plain) return null;
  const at = plain.indexOf("@");
  if (at > 0) return `${plain.slice(0, 1)}•••${plain.slice(at)}`;
  if (plain.length <= 2) return `${plain.slice(0, 1)}•••`;
  return `${plain.slice(0, 2)}•••`;
}

function addMonthsToKey(dateKey: string, months: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export type RotationState = { dueOnKey: string; overdue: boolean };

/**
 * When the next password change is due: from the last rotation, or from the
 * day the login was added when it has never been rotated. Null when the
 * login carries no rotation schedule (spec §6: reminders only then).
 */
export function rotationState(
  input: { lastRotatedOn: Date | null; createdAt: Date; rotateEveryMonths: number | null },
  now: Date,
): RotationState | null {
  if (!input.rotateEveryMonths || input.rotateEveryMonths < 1) return null;
  const base = input.lastRotatedOn ?? input.createdAt;
  const dueOnKey = addMonthsToKey(businessDateKey(base), input.rotateEveryMonths);
  return { dueOnKey, overdue: dueOnKey <= businessDateKey(now) };
}
