// OPS-1: matching a government recall notice against one of our machines. Pure: no database, no network, no clock.
// The nightly check only ever produces POSSIBLE matches; Chris decides. The recall list has no model field, so a model
// is looked for in the product and description text (docs/research/2026-10-25-operating-risks.md item 1).

export type RecallProduct = { name: string; description: string; model: string };

export type RecallRecord = {
  recallId: string;
  recallNumber: string;
  title: string;
  url: string;
  publishedAt: Date | null;
  hazard: string | null;
  remedy: string | null;
  description: string;
  manufacturers: string[];
  products: RecallProduct[];
};

export type ApplianceForMatch = { manufacturer: string | null; model: string | null };

export type RecallMatchResult = { reason: string };

const COMPANY_WORDS = new Set([
  "inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "usa", "us", "america",
  "americas", "north", "group", "the", "of", "and", "international", "intl", "brands", "holdings",
]);

/** Lower-case words with punctuation and company endings removed ("Galanz Americas Co., Ltd." -> "galanz"). */
export function nameWords(value: string): string[] {
  const words = value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
  const core = words.filter((word) => !COMPANY_WORDS.has(word));
  return core.length > 0 ? core : words;
}

/** True when one maker name is the other, or one is a whole-word run inside the other ("GE" never matches "Gerber"). */
export function sameMaker(ours: string, theirs: string): boolean {
  const a = nameWords(ours);
  const b = nameWords(theirs);
  if (a.length === 0 || b.length === 0) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  for (let start = 0; start + short.length <= long.length; start += 1) {
    if (short.every((word, index) => long[start + index] === word)) return true;
  }
  return false;
}

/** Letters and digits only, upper-case, so "GLR-10 TR" and "glr10tr" compare equal. */
export function modelKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

/** A model shorter than this would match by accident ("A1" inside any text), so it is treated as not found. */
const MIN_MODEL_KEY_LENGTH = 3;

function recallText(recall: RecallRecord): string {
  return [
    recall.title,
    recall.description,
    ...recall.products.flatMap((product) => [product.name, product.description, product.model]),
  ].join(" ");
}

export function matchRecallToAppliance(recall: RecallRecord, appliance: ApplianceForMatch): RecallMatchResult | null {
  const ourMaker = appliance.manufacturer?.trim();
  if (!ourMaker) return null;
  const makers = [...recall.manufacturers, ...recall.products.map((product) => product.name)];
  const maker = makers.find((name) => name.trim() && sameMaker(ourMaker, name));
  if (!maker) return null;

  const ourModel = appliance.model?.trim();
  if (!ourModel) {
    return { reason: `The maker (${ourMaker}) matches. No model number is on file for this machine, so it may or may not be one of the recalled models.` };
  }
  const key = modelKey(ourModel);
  if (key.length >= MIN_MODEL_KEY_LENGTH && modelKey(recallText(recall)).includes(key)) {
    return { reason: `The maker (${ourMaker}) matches and model ${ourModel} appears in the recall notice.` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reading the government's answer. Field names are the ones the Recall Retrieval API documents (RecallID, RecallNumber,
// Title, URL, RecallDate, LastPublishDate, Description, Products[], Manufacturers[], Hazards[], Remedies[]).
// Anything missing or odd is skipped, never guessed.
// ---------------------------------------------------------------------------
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object") : [];
}

function parseDate(value: unknown): Date | null {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseCpscRecalls(json: unknown): RecallRecord[] {
  if (!Array.isArray(json)) return [];
  const records: RecallRecord[] = [];
  for (const item of json) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const recallId = text(raw.RecallID);
    const recallNumber = text(raw.RecallNumber);
    const url = text(raw.URL);
    if (!recallId || !recallNumber) continue;
    // Only ever show a link that really is on the government's own site.
    const safeUrl = /^https:\/\/([a-z0-9-]+\.)*cpsc\.gov(\/|$)/i.test(url) || /^https:\/\/www\.saferproducts\.gov(\/|$)/i.test(url)
      ? url
      : `https://www.cpsc.gov/Recalls`;
    const hazards = list(raw.Hazards).map((hazard) => text(hazard.Name)).filter(Boolean);
    const remedies = list(raw.Remedies).map((remedy) => text(remedy.Name)).filter(Boolean);
    const options = list(raw.RemedyOptions).map((option) => text(option.Option)).filter(Boolean);
    records.push({
      recallId,
      recallNumber,
      title: text(raw.Title) || `Recall ${recallNumber}`,
      url: safeUrl,
      publishedAt: parseDate(raw.RecallDate) ?? parseDate(raw.LastPublishDate),
      hazard: hazards.length ? hazards.join("; ") : null,
      remedy: [...remedies, ...options].length ? [...remedies, ...options].join("; ") : null,
      description: text(raw.Description),
      manufacturers: list(raw.Manufacturers).map((maker) => text(maker.Name)).filter(Boolean),
      products: list(raw.Products).map((product) => ({
        name: text(product.Name),
        description: text(product.Description),
        model: text(product.Model),
      })),
    });
  }
  return records;
}
