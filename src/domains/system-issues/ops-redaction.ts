import { Prisma } from "@prisma/client";

const REPLACED = "[private information removed]";
/** Mitigation for private human notes, never a guarantee of anonymity. */
export function redactForOps(text: string): string {
  if (typeof text !== "string") throw new Error("A note must be text.");
  if (Buffer.byteLength(text, "utf8") > 2048) throw new Error("Keep notes below 2 KB.");
  return text
    .replace(/\{[^{}]{1,1800}\}/g, REPLACED)
    .replace(/\b(?:Bearer\s+\S+|(?:sk|rk|whsec)_[A-Za-z0-9_-]+)\b/gi, REPLACED)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, REPLACED)
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, REPLACED)
    .replace(/\b\d{1,6}\s+(?:[A-Za-z]+\s+){0,4}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Lane|Ln|Court|Ct)\b\.?/gi, REPLACED)
    .replace(/\b(?:\d[\s-]*?){8,19}\b/g, REPLACED)
    .replace(/https?:\/\/[^\s]+/gi, "[link removed]");
}
function normalized(value: string): string {
  return value.toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}
/** Reject names from active customer/lead/staff records before saving private prose. */
export async function assertNoKnownPersonNames(tx: Prisma.TransactionClient, text: string): Promise<void> {
  const people = await tx.$queryRaw<{ name: string }[]>`
    SELECT name FROM "User" WHERE name IS NOT NULL
    UNION SELECT name FROM "CustomerContact" WHERE name IS NOT NULL
    UNION SELECT "contactName" AS name FROM "Lead" WHERE "contactName" IS NOT NULL
  `;
  const contents = normalized(text);
  const words = contents.split(" ");
  for (const person of people) {
    const parts = normalized(person.name).split(" ").filter((part) => part.length >= 2);
    if (parts.length < 2) continue;
    const fullName = parts.join(" ");
    const last = parts[parts.length - 1];
    if ((" " + contents + " ").includes(" " + fullName + " ")) {
      throw new Error("This note mentions a customer or person — describe the problem without names.");
    }
    if (last.length >= 4 && words.includes(last)) {
      const original = text.match(/\b[A-Z][A-Za-z0-9]+\s+[A-Z][A-Za-z0-9]+\b/g) ?? [];
      if (original.some((pair) => normalized(pair).split(" ").includes(last))) {
        throw new Error("This note mentions a customer or person — describe the problem without names.");
      }
    }
  }
}
