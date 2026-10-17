import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { TRANSACTIONAL_COPY, type MessageCatalog } from "./transactional-copy";
import { allSpanishSurfacesReady, reviewedCopyDigest } from "./review";
import { listCurrentTranslationDrafts, type TranslationSource } from "./drafts";
import type { CustomerLanguage } from "./copy";

export async function approvedSpanishSnapshot(): Promise<{sources:TranslationSource[];digest:string|null}> {
  if (!allSpanishSurfacesReady) return {sources:[],digest:null};
  const sources = await listCurrentTranslationDrafts();
  const review = await prisma.customerLanguageReview.findUnique({where:{language:"es"}});
  if (!review?.publishedAt || !review.reviewedAt || !review.legalReviewedAt ||
      review.copyDigest !== reviewedCopyDigest(sources) ||
      sources.some(source => source.stale || !source.spanish?.trim())) return {sources:[],digest:null};
  return {sources,digest:review.copyDigest};
}

export async function approvedSpanishSources() { return (await approvedSpanishSnapshot()).sources; }

export function translationFromSnapshot(sources: TranslationSource[], kind: TranslationSource["kind"], key: string, english: string): string {
  const source = sources.find(source => source.kind === kind && source.key === key);
  const digest = createHash("sha256").update(english).digest("hex");
  if (!source?.spanish?.trim() || source.stale || source.digest !== digest)
    throw new Error("The current Spanish translation requires review before use.");
  return source.spanish;
}

export async function activeMessageCatalog(language: CustomerLanguage): Promise<MessageCatalog> {
  if (language === "en") return TRANSACTIONAL_COPY.en;
  const sources = await approvedSpanishSources();
  return Object.fromEntries(Object.entries(TRANSACTIONAL_COPY.en).map(([key,english]) =>
    [key,translationFromSnapshot(sources,"MESSAGE",key,english)])) as MessageCatalog;
}
