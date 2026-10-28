import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { ruleAsOf, RuleMissingError } from "@/domains/rules/reads";

/**
 * TAXBEN-1 — the written capitalization policy (TAX-BENEFITS.md section 1).
 *
 * The de minimis safe harbor needs a written accounting policy in place at
 * the start of the year. The app generates the policy from the rule book,
 * the owner signs it on screen, and it is stored as a business record
 * (Business records, kind DOCUMENT). A To do each December asks for the
 * next year's signature. Signing again never rewrites a signed policy.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export function policyTemplateKey(year: number): string {
  return `taxben-capitalization-policy-${year}`;
}

/** True for the business record that holds a signed capitalization policy. */
export function isCapitalizationPolicyTemplateKey(templateKey: string | null | undefined): boolean {
  return typeof templateKey === "string" && templateKey.startsWith("taxben-capitalization-policy-");
}

export type PolicyFacts = {
  businessName: string;
  year: number;
  limitCents: number | null;
  bonusPercent: number | null;
  bonusAcquiredAfter: string | null;
  preferSection179: boolean;
  signerName: string | null;
  signedOnKey: string | null;
};

/** The policy document, in plain words. Pure. */
export function capitalizationPolicyText(facts: PolicyFacts): string {
  const limit = facts.limitCents !== null ? formatMoney(facts.limitCents) : "the limit in the rule book";
  const lines = [
    `Capitalization policy — ${facts.businessName}`,
    `For the ${facts.year} tax year.`,
    "",
    `What this business expenses right away: a bought item whose invoice line — the item's price plus its share of any delivery or installation charges on the same invoice — is at or under ${limit} is expensed in the year it is bought, under the IRS de minimis safe harbor. The business elects the safe harbor for ${facts.year} and keeps this written policy in place from the start of the year.`,
    "",
    facts.preferSection179
      ? "What this business capitalizes: anything over that limit is recorded as equipment. The business's CPA has chosen Section 179 expensing for qualifying equipment instead of bonus depreciation."
      : `What this business capitalizes: anything over that limit is recorded as equipment and written off over its class life${facts.bonusPercent !== null ? `, claiming ${facts.bonusPercent}% bonus depreciation for property acquired after ${facts.bonusAcquiredAfter} when it qualifies` : ""}. Property bought from a relative or from the owner's other business does not qualify for bonus depreciation.`,
    "",
    "Expensed items stay in the asset register and on the county property declaration.",
    "",
    "This policy was prepared from the business's rule book. The business's CPA confirms it.",
  ];
  if (facts.signerName && facts.signedOnKey) {
    lines.push("", `Signed: ${facts.signerName} — ${facts.signedOnKey}`);
  }
  return lines.join("\n");
}

export type PolicyState = {
  year: number;
  status: "SIGNED" | "MISSING";
  recordId: string | null;
  signedOn: string | null;
};

/** Whether the year's policy has been signed and stored. */
export async function getPolicyState(db: Db, year: number): Promise<PolicyState> {
  const record = await db.businessPaperwork.findUnique({
    where: { templateKey: policyTemplateKey(year) },
    select: { id: true, status: true, issuedOn: true },
  });
  if (record && record.status === "DONE") {
    return {
      year,
      status: "SIGNED",
      recordId: record.id,
      signedOn: record.issuedOn ? businessDateKey(record.issuedOn) : null,
    };
  }
  return { year, status: "MISSING", recordId: record?.id ?? null, signedOn: null };
}

async function policyFacts(
  db: Db,
  year: number,
  signerName: string | null,
  signedOnKey: string | null,
): Promise<PolicyFacts> {
  const [profile, settings] = await Promise.all([
    db.complianceProfile.findUnique({ where: { id: "singleton" }, select: { businessLegalName: true } }),
    db.businessSettings.findUnique({ where: { id: "singleton" }, select: { capitalizationPreference: true } }),
  ]);
  const jan1 = businessDateFromKey(`${year}-01-01`) ?? new Date();
  let limitCents: number | null = null;
  let bonus: { percent: number; acquiredAfter: string } | null = null;
  try {
    limitCents = (await ruleAsOf<number>("us.de_minimis_per_item", jan1, db)).value;
  } catch (error) {
    if (!(error instanceof RuleMissingError)) throw error;
  }
  try {
    bonus = (await ruleAsOf<{ percent: number; acquiredAfter: string }>("us.bonus_depreciation", jan1, db)).value;
  } catch (error) {
    if (!(error instanceof RuleMissingError)) throw error;
  }
  return {
    businessName: profile?.businessLegalName ?? "Robinson Appliance Rentals",
    year,
    limitCents,
    bonusPercent: bonus?.percent ?? null,
    bonusAcquiredAfter: bonus?.acquiredAfter ?? null,
    preferSection179: settings?.capitalizationPreference === "SECTION179",
    signerName,
    signedOnKey,
  };
}

/** The unsigned policy text for a year, ready to read and sign. */
export async function previewCapitalizationPolicy(db: Db, year: number): Promise<string> {
  return capitalizationPolicyText(await policyFacts(db, year, null, null));
}

/**
 * The owner signs the year's policy on screen: the generated document is
 * stored as a business record, marked done, and the signing is audited.
 * Signing an already-signed year changes nothing.
 */
export async function signCapitalizationPolicy(
  actorId: string,
  year: number,
  now = new Date(),
): Promise<PolicyState> {
  return prisma.$transaction(async (tx) => {
    const actor = await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    const existing = await getPolicyState(tx, year);
    if (existing.status === "SIGNED") return existing;
    const signer = await tx.user.findUnique({
      where: { id: actor.id }, select: { name: true, email: true },
    });
    const signedOnKey = businessDateKey(now);
    const facts = await policyFacts(tx, year, signer?.name ?? signer?.email ?? null, signedOnKey);
    const text = capitalizationPolicyText(facts);
    const signedOn = businessDateFromKey(signedOnKey) ?? now;
    const data = {
      title: `Capitalization policy — ${year}`,
      groupName: "Taxes",
      kind: "DOCUMENT",
      whatItIs:
        "The written capitalization policy the de minimis safe harbor requires: items at or under the rule-book limit per invoice line are expensed; the rest is capitalized. Signed by the owner.",
      status: "DONE" as const,
      issuedOn: signedOn,
      lastDoneOn: signedOn,
      notes: text,
      updatedByUserId: actorId,
    };
    const record = existing.recordId
      ? await tx.businessPaperwork.update({ where: { id: existing.recordId }, data })
      : await tx.businessPaperwork.create({
          data: { ...data, templateKey: policyTemplateKey(year), createdByUserId: actorId },
        });
    await tx.auditLog.create({
      data: {
        userId: actorId, action: "taxben.policy_signed", entityType: "BusinessPaperwork", entityId: record.id,
        // The fingerprint of the exact signed text lives in this append-only
        // audit row, so a later change to the record is always detectable.
        newValue: { year, limitCents: facts.limitCents, textSha256: createHash("sha256").update(text).digest("hex") },
      },
    });
    return { year, status: "SIGNED" as const, recordId: record.id, signedOn: signedOnKey };
  }, { timeout: 30_000, maxWait: 10_000 });
}

// ---------------------------------------------------------------------------
// The signing To do (Today)
// ---------------------------------------------------------------------------

export type PolicyAttention = {
  year: number;
  /** True in December, when the item is about next year's policy. */
  renewal: boolean;
  since: Date;
};

/**
 * Unsigned-policy items for Today: the current year's policy whenever it
 * is unsigned, plus next year's every December until it is signed.
 */
export async function listPolicyAttention(now = new Date(), db: Db = prisma): Promise<PolicyAttention[]> {
  const key = businessDateKey(now);
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const items: PolicyAttention[] = [];
  const current = await getPolicyState(db, year);
  if (current.status !== "SIGNED") items.push({ year, renewal: false, since: now });
  if (month === 12) {
    const next = await getPolicyState(db, year + 1);
    if (next.status !== "SIGNED") items.push({ year: year + 1, renewal: true, since: now });
  }
  return items;
}
