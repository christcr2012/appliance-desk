// W-8 (D-W7): plain-words check. The owner is not a developer, so words that only a tax professional or a
// programmer would use must not appear on owner screens. This scans the text a person can read (page text,
// labels, titles, descriptions, placeholders and the To do titles/details) and refuses a reviewed list of phrases,
// each with the plain replacement. Adding to scripts/owner-wording-allowlist.json needs a written reason.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const BANNED = [
  { pattern: /taxability matrix/i, say: "what gets taxed" },
  { pattern: /\bremit(?:s|ted|ting|tance|tances)?\b/i, say: "pay" },
  { pattern: /\belections?\b/i, say: "choice" },
  { pattern: /\(cents\)|\bin cents\b/i, say: "dollars (money is always shown and typed in dollars)" },
  { pattern: /\b[A-Z]{2,}_[A-Z0-9_]{2,}\b/, say: "the plain label for this status, never the stored code" },
  { pattern: /\bidempoten\w*/i, say: "(say what happens, for example 'safe to repeat')" },
  { pattern: /\bpayload\b/i, say: "the information sent" },
  { pattern: /\bnexus\b/i, say: "where you owe tax" },
  { pattern: /\bjurisdictions?\b/i, say: "tax area" },
  { pattern: /\bwebhooks?\b/i, say: "payment updates from Stripe" },
];


// AR-12: only newly redesigned screens and the shared kit get the stricter vocabulary.
// The accountant's books reports must keep their professional field names.
export const EVERYDAY_BANNED = [
  { pattern: /\binvoices?\b/i, say: "bill" },
  { pattern: /\baccounts? receivable\b|\breceivables?\b/i, say: "money customers owe you" },
  { pattern: /\baccounts? payable\b|\bpayables?\b/i, say: "bills you owe" },
  { pattern: /\bjournal entr\w*|\bledger\b|\bposting\b/i, say: "your records" },
  { pattern: /\baccrual\b|\bcash basis\b/i, say: "when billed / when paid" },
  { pattern: /\bdepreciat\w*/i, say: "equipment value going down" },
  { pattern: /\bcapitaliz\w*/i, say: "count as equipment" },
  { pattern: /\breconcil\w*/i, say: "check against your bank" },
  { pattern: /\bwrite-?offs?\b|\bwritten off\b/i, say: "give up on this bill" },
  { pattern: /\bchargebacks?\b/i, say: "customer disputed the payment with their bank" },
  { pattern: /\bdeferred revenue\b|\bunearned\b/i, say: "rent paid in advance" },
  { pattern: /\bpayment intents?\b|\bcheckout session\b|\bcron\b|\bAPI\b|\bsync(?:ed|ing)?\b/i, say: "say what happened" },
  { pattern: /(?<!rental )\bagreements?\b/i, say: "rental" },
  { pattern: /\bSKUs?\b|\basset numbers?\b/i, say: "item number / appliance number" },
];

const migrated = JSON.parse(readFileSync("docs/build-specs/migrated-pages.json", "utf8"));
const migratedPaths = new Set(migrated.map((item) => typeof item === "string" ? item : item.file));
export function isEverydayScreen(path) {
  const normalized = path.replaceAll("\\", "/");
  // Accountant-only books pages intentionally use specialized field labels.
  if (/^src\/app\/desk\/books\/(reports|exports?|closing|assets)(?:\/|$)/.test(normalized)) return false;
  return normalized.startsWith("src/components/kit/") || migratedPaths.has(normalized);
}

const TEXT_PROPS = "title|label|description|placeholder|submitLabel|confirmText|aria-label|detail|summary|emptyMessage|heading|hint";
const RULES = [
  // Text between tags on one line, without braces: <p>Some words</p>
  { re: />([^<>{}\n]*[A-Za-z][^<>{}\n]*)</g },
  // title="..." style props
  { re: new RegExp(`\\b(?:${TEXT_PROPS})\\s*=\\s*"([^"]+)"`, "g") },
  // title: "..." style object fields (To do titles and details) and `...` template text
  { re: new RegExp(`\\b(?:${TEXT_PROPS}):\\s*"([^"]+)"`, "g") },
  { re: new RegExp(`\\b(?:${TEXT_PROPS}):\\s*\`([^\`$]+)\``, "g") },
];

export function visibleText(source) {
  const out = [];
  source.split("\n").forEach((line, index) => {
    for (const { re } of RULES) {
      re.lastIndex = 0;
      for (const match of line.matchAll(re)) out.push({ line: index + 1, text: match[1] });
    }
  });
  return out;
}

export function findViolations(path, source, allow = []) {
  const found = [];
  for (const { line, text } of visibleText(source)) {
    for (const rule of (isEverydayScreen(path) ? [...BANNED, ...EVERYDAY_BANNED] : BANNED)) {
      const hit = rule.pattern.exec(text);
      if (!hit) continue;
      if (allow.some((entry) => entry.file === path && entry.phrase.toLowerCase() === hit[0].toLowerCase())) continue;
      found.push(`${path}:${line}: "${hit[0]}" → say ${rule.say}`);
    }
  }
  return found;
}

function files(folder, extension, acc = []) {
  if (!existsSync(folder)) return acc;
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) files(path, extension, acc);
    else if (extension.some((ext) => entry.name.endsWith(ext)) && !entry.name.endsWith(".test.tsx")) acc.push(path);
  }
  return acc;
}

export function loadAllowlist(path = "scripts/owner-wording-allowlist.json") {
  if (!existsSync(path)) return [];
  const list = JSON.parse(readFileSync(path, "utf8"));
  for (const entry of list) {
    if (!entry.file || !entry.phrase || !entry.reason || String(entry.reason).trim().length < 15)
      throw new Error("Every allowlist entry needs a file, a phrase and a written reason.");
  }
  return list;
}

function main() {
  const allow = loadAllowlist();
  const scanned = [
    ...files("src/app/desk", [".tsx"]),
    ...files("src/components/desk", [".tsx"]),
    ...files("src/components/kit", [".ts", ".tsx"]),
    "src/domains/exceptions/rules.ts",
    "src/domains/exceptions/money-turning-points.ts",
  ].filter(existsSync);
  const violations = scanned.flatMap((path) => findViolations(path, readFileSync(path, "utf8"), allow));
  if (violations.length) {
    console.error("Owner screens must use plain words (W-8):\n" + violations.join("\n"));
    process.exitCode = 1;
  } else console.log(`Plain-words check passed (${scanned.length} files).`);
}
if (process.argv[1]?.endsWith("check-owner-wording.mjs")) main();
