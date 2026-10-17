import "server-only";
import { assertActiveTeamActor } from "@/lib/team-actor";

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { customerStrings, customerLanguageActive, type CustomerLanguage } from "./copy";
import { NOTICE_COPY, NOTICE_WRAPPER_COPY } from "./notice-copy";
import { TERMS_SPANISH_COPY } from "@/domains/agreements/terms-snapshot";
import { PORTAL_SMS_DISCLOSURE, PORTAL_SMS_DISCLOSURE_ES } from "@/domains/messaging/portal-disclosure";
import { TRANSACTIONAL_COPY } from "./transactional-copy";
import { SPANISH_STATUS_LABELS } from "@/lib/status-labels";
import { ESTIMATE_COPY } from "./estimate-copy";
import { FORM_COPY } from "./estimate-form-copy";
import { SIGNING_COPY } from "./signing-copy";
import { PORTAL_TRANSLATIONS, PORTAL_DYNAMIC_COPY } from "./portal-copy";
import { REVIEWED_MONEY_LABELS } from "./reviewed-money";
import { listCurrentTranslationDrafts, type TranslationSource } from "./drafts";

// Do not allow a fluent/legal record to activate a PARTIAL customer journey.
// Each surface flips only after its original W-26 bilingual consumer evidence.
import { allSpanishSurfacesReady } from "./readiness";
export { allSpanishSurfacesReady, CUSTOMER_SPANISH_SURFACE_READINESS } from "./readiness";

/** The reviewed snapshot is deliberately versioned by the actual user-visible copy.
 * A deploy that changes a translated string invalidates the previous review. */
export function spanishCopyDigest(): string {
  return createHash("sha256")
    .update(JSON.stringify(customerStrings.en))
    .update(JSON.stringify(customerStrings.es))
    .update(JSON.stringify(ESTIMATE_COPY))
    .update(JSON.stringify(FORM_COPY))
    .update(JSON.stringify(SIGNING_COPY))
    .update(JSON.stringify(PORTAL_TRANSLATIONS))
    .update(JSON.stringify(PORTAL_DYNAMIC_COPY))
    .update(JSON.stringify(REVIEWED_MONEY_LABELS))
    .update(JSON.stringify(TRANSACTIONAL_COPY))
    .update(JSON.stringify(SPANISH_STATUS_LABELS))
    .update(JSON.stringify(TERMS_SPANISH_COPY))
    .update(JSON.stringify(NOTICE_COPY))
    .update(JSON.stringify(NOTICE_WRAPPER_COPY))
    .update(JSON.stringify([PORTAL_SMS_DISCLOSURE, PORTAL_SMS_DISCLOSURE_ES]))
    .digest("hex");
}

/** Review evidence covers owner-editable copy too, not merely static TS dictionaries.
 * Changing, deleting, replacing or stale-marking any source invalidates approval. */
export function reviewedCopyDigest(sources: TranslationSource[]): string {
  const canonical = sources.map(source => ({
    kind: source.kind,
    key: source.key,
    englishDigest: source.digest,
    spanish: source.spanish,
    stale: source.stale,
  })).sort((a,b) => (a.kind + ":" + a.key).localeCompare(b.kind + ":" + b.key));
  return createHash("sha256").update(spanishCopyDigest()).update(JSON.stringify(canonical)).digest("hex");
}

async function currentReviewerContent() {
  const sources = await listCurrentTranslationDrafts();
  return {
    digest: reviewedCopyDigest(sources),
    complete: sources.every(source => Boolean(source.spanish?.trim()) && !source.stale),
  };
}

export type SpanishReviewSnapshot = {
  currentDigest: string;
  reviewedDigest: string | null;
  reviewerName: string | null;
  reviewReference: string | null;
  reviewedAt: Date | null;
  legalReviewerName: string | null;
  legalReviewReference: string | null;
  legalReviewedAt: Date | null;
  publishedAt: Date | null;
  currentReview: boolean;
  enabled: boolean;
};

export async function getSpanishReview(): Promise<SpanishReviewSnapshot> {
  const { digest: currentDigest, complete } = await currentReviewerContent();
  const row = await prisma.customerLanguageReview.findUnique({
    where: { language: "es" },
  });
  const currentReview = Boolean(row?.reviewedAt && row.copyDigest === currentDigest);
  // Every customer-facing Spanish runtime path checks the same fail-closed gate.
  const enabled = Boolean(allSpanishSurfacesReady && complete && currentReview && row?.legalReviewedAt && row?.publishedAt);
  return {
    currentDigest,
    reviewedDigest: row?.copyDigest ?? null,
    reviewerName: row?.reviewerName ?? null,
    reviewReference: row?.reviewReference ?? null,
    reviewedAt: row?.reviewedAt ?? null,
    legalReviewerName: row?.legalReviewerName ?? null,
    legalReviewReference: row?.legalReviewReference ?? null,
    legalReviewedAt: row?.legalReviewedAt ?? null,
    publishedAt: row?.publishedAt ?? null,
    currentReview,
    enabled,
  };
}

export async function displayCustomerLanguage(preference: CustomerLanguage): Promise<CustomerLanguage> {
  if (preference === "en") return "en";
  // No unreviewed user preference may trigger expensive draft reads or translation output.
  if (!allSpanishSurfacesReady) return "en";
  const review = await getSpanishReview();
  return customerLanguageActive(preference, review.enabled);
}

const MAX_REVIEW_EVIDENCE = 500;
function validateEvidence(input: string, label: string): string {
  const value = input.trim();
  if (value.length < 3 || value.length > MAX_REVIEW_EVIDENCE)
    throw new Error(label + " requires a descriptive 3–500-character verified reference.");
  return value;
}

/** Owner attests an actual review performed externally, with immutable event history.
 * No automatic review, translation, payment, messaging or deployment occurs here. */
export async function recordSpanishReview(
  actorUserId: string,
  kind: "FLUENT" | "LEGAL" | "PUBLISH" | "DISABLE",
  details: { reviewer?: string; reference?: string; expectedDigest?:string } = {},
): Promise<void> {
  const now = new Date();
  const reviewer = kind === "FLUENT" || kind === "LEGAL"
    ? validateEvidence(details.reviewer ?? "", "Reviewer identity") : "";
  const reference = kind === "FLUENT" || kind === "LEGAL"
    ? validateEvidence(details.reference ?? "", "Review evidence") : "";
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"customer-spanish-review"}, 0))`;
    const old = await tx.customerLanguageReview.findUnique({ where: { language: "es" } });
    // Disable never depends on translated-content availability. Every attestation
    // is bound to the fingerprint actually displayed to the owner.
    const content=kind==="DISABLE"?{digest:old?.copyDigest ?? "",complete:false}:await currentReviewerContent();
    const {digest,complete}=content;
    if(kind!=="DISABLE" && (!details.expectedDigest || details.expectedDigest!==digest))
      throw new Error("Translation content changed. Reload and review the current fingerprint before recording approval.");
    if (kind !== "FLUENT" && kind !== "DISABLE" && (!old || old.copyDigest !== digest || !old.reviewedAt))
      throw new Error("A fluent reviewer must reapprove the current bilingual content first.");
    if (kind === "DISABLE" && !old)
      throw new Error("No recorded Spanish release to disable.");
    if (kind === "PUBLISH" && (!allSpanishSurfacesReady || !complete))
      throw new Error("Complete all W-26 translated customer pages, messages and tests before activation.");
    if (kind === "PUBLISH" && !old?.legalReviewedAt)
      throw new Error("The controlling-English/legal translation review must be recorded before publication.");
    if (kind === "LEGAL" && !old)
      throw new Error("Record fluent review before legal translation review.");

    if (kind === "FLUENT") {
      await tx.customerLanguageReview.upsert({
        where: { language: "es" },
        create: {
          language: "es", copyDigest: digest, reviewerName: reviewer,
          reviewReference: reference, reviewedAt: now,
        },
        update: {
          copyDigest: digest, reviewerName: reviewer, reviewReference: reference,
          reviewedAt: now,
          // A new or repeated review never silently preserves live publication.
          publishedAt: null, publishedByUserId: null,
          legalReviewedAt: null, legalReviewerName: null, legalReviewReference: null,
        },
      });
    } else if (kind === "LEGAL") {
      await tx.customerLanguageReview.update({
        where: { language: "es" },
        data: {
          legalReviewerName: reviewer, legalReviewReference: reference,
          legalReviewedAt: now, publishedAt: null, publishedByUserId: null,
        },
      });
    } else {
      await tx.customerLanguageReview.update({
        where: { language: "es" },
        data: { publishedAt: kind === "PUBLISH" ? now : null,
          publishedByUserId: kind === "PUBLISH" ? actorUserId : null },
      });
    }
    await tx.customerLanguageReviewEvent.create({
      data: {
        language: "es", actorUserId, action: kind, reviewedDigest: digest,
        evidenceReference: reference || null,
      },
    });
  });
}
