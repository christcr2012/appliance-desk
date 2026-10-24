// ACC-1: small pure rules for My account (no database), so they can be tested on their own.

export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountError";
  }
}

/** US numbers only for now. Returns +1XXXXXXXXXX, or null for "no phone". */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  let digits = trimmed.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (!/^[2-9][0-9]{2}[2-9][0-9]{6}$/.test(digits)) {
    throw new AccountError("Enter a 10-digit US phone number, like 970-555-0123, or leave it blank.");
  }
  return `+1${digits}`;
}

export function cleanName(input: string): string {
  const name = input.replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 100 || /[\u0000-\u001f]/.test(name)) {
    throw new AccountError("Enter your name (up to 100 characters).");
  }
  return name;
}

export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

