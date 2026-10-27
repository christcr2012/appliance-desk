import { businessDateFromKey, businessDateKey, businessDaysBetween } from "@/lib/business-date";

export type PaperworkStatusValue = "TO_DO" | "IN_PROGRESS" | "DONE" | "NOT_NEEDED";

export const PAPERWORK_STATUS_LABEL: Record<PaperworkStatusValue, string> = {
  TO_DO: "Not started",
  IN_PROGRESS: "In progress",
  DONE: "Done / in place",
  NOT_NEEDED: "Not needed",
};

export const PAPERWORK_GROUPS = [
  "Start the business",
  "Taxes",
  "Licenses and permits",
  "Insurance",
  "Every year",
  "Other",
] as const;

/** Add whole months to a Denver business date (YYYY-MM-DD), keeping the day unless the month is shorter. */
export function addMonthsToDateKey(key: string, months: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match || !Number.isInteger(months)) throw new Error("Invalid date.");
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const total = year * 12 + (month - 1) + months;
  const newYear = Math.floor(total / 12);
  const newMonth = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(newYear, newMonth, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${newYear}-${pad(newMonth)}-${pad(Math.min(day, lastDay))}`;
}

export type ReminderState =
  | { kind: "none" }
  | { kind: "upcoming"; daysLeft: number }
  | { kind: "due_soon"; daysLeft: number }
  | { kind: "overdue"; daysOver: number };

/** When should this item appear on the To do list? Pure so it is easy to test. */
export function reminderState(
  item: { status: PaperworkStatusValue; dueOn: Date | null; remindDaysBefore: number },
  now: Date,
): ReminderState {
  if (item.status === "NOT_NEEDED" || !item.dueOn) return { kind: "none" };
  const daysLeft = businessDaysBetween(now, item.dueOn);
  if (daysLeft < 0) return { kind: "overdue", daysOver: -daysLeft };
  if (daysLeft <= item.remindDaysBefore) return { kind: "due_soon", daysLeft };
  return { kind: "upcoming", daysLeft };
}

/** The date after "marked renewed": the old date plus the repeat length, never earlier than today. */
export function nextDueAfterRenewal(
  dueOn: Date,
  repeatEveryMonths: number,
  now: Date,
): Date {
  let key = addMonthsToDateKey(businessDateKey(dueOn), repeatEveryMonths);
  const today = businessDateKey(now);
  // A long-overdue item jumps forward to the next future date instead of staying overdue.
  for (let i = 0; key <= today && i < 200; i += 1) key = addMonthsToDateKey(key, repeatEveryMonths);
  const result = businessDateFromKey(key);
  if (!result) throw new Error("Invalid renewal date.");
  return result;
}

/**
 * Content-Disposition for a download whose name the owner typed: header
 * values must be ByteStrings, so a name outside Latin-1 (Japanese, emoji)
 * would throw. Send an ASCII fallback plus the RFC 5987 UTF-8 form.
 */
export function contentDisposition(fileName: string, disposition: "inline" | "attachment" = "inline"): string {
  const fallback = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "file";
  const encoded = encodeURIComponent(fileName)
    .replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function maskReference(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// VAULT-1: business records. A paperwork item is a record; these are the kinds,
// the admin-visibility rule and the stored-file checks. Pure, so they are easy
// to test without a database.

export const RECORD_KINDS = [
  "TASK",
  "LICENSE",
  "PERMIT",
  "REGISTRATION",
  "TAX_ACCOUNT",
  "INSURANCE",
  "BANK",
  "DOCUMENT",
  "ACCOUNT",
  "VEHICLE",
  "CONTRACT",
] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const RECORD_KIND_LABEL: Record<RecordKind, string> = {
  TASK: "Task",
  LICENSE: "License",
  PERMIT: "Permit",
  REGISTRATION: "Registration",
  TAX_ACCOUNT: "Tax account",
  INSURANCE: "Insurance",
  BANK: "Bank",
  DOCUMENT: "Document",
  ACCOUNT: "Account",
  VEHICLE: "Vehicle",
  CONTRACT: "Contract",
};

/** The starting value for the "Kinds admins may see" owner setting. */
export const RECOMMENDED_ADMIN_KINDS: RecordKind[] = [
  "DOCUMENT",
  "LICENSE",
  "PERMIT",
  "REGISTRATION",
  "INSURANCE",
  "VEHICLE",
  "CONTRACT",
];

export function isRecordKind(value: string): value is RecordKind {
  return (RECORD_KINDS as readonly string[]).includes(value);
}

/**
 * May an ADMIN open this record (read-only)? Only when the owner setting lists
 * its kind AND the record holds no encrypted number. A number-bearing record
 * is owner-only whatever its kind — this is a domain rule, not just a default.
 */
export function adminCanSeeRecord(
  record: { kind: string; hasNumber: boolean },
  adminKinds: readonly string[],
): boolean {
  if (record.hasNumber) return false;
  return adminKinds.includes(record.kind);
}

/**
 * ACCT-1: may the ACCOUNTANT see this record? Only when the owner marked it
 * "Share with my accountant" (off by default). The DTO still masks any saved
 * number for them, exactly like an admin's view.
 */
export function accountantCanSeeRecord(record: { shareWithAccountant: boolean }): boolean {
  return record.shareWithAccountant === true;
}

/** The date a renewal reminder keys off: the earlier of the expiry and the next action date. */
export function effectiveRecordDate(record: { dueOn: Date | null; expiresOn: Date | null }): Date | null {
  if (record.dueOn && record.expiresOn) return record.dueOn < record.expiresOn ? record.dueOn : record.expiresOn;
  return record.dueOn ?? record.expiresOn;
}

export const RECORD_FILE_MAX_BYTES = 900 * 1024;
export const RECORD_PDF_MAX_BYTES = 15 * 1024 * 1024;

export type RecordFileKind = { contentType: string; extension: string };

/** Sniff a stored record file's real type from its first bytes — the name a client gives it is never trusted. */
export function sniffRecordFile(bytes: Uint8Array): RecordFileKind | null {
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d
  ) {
    return { contentType: "application/pdf", extension: "pdf" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return { contentType: "image/png", extension: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { contentType: "image/webp", extension: "webp" };
  }
  return null;
}
