import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { CustomerLanguage } from "./copy";
export function legalSourceKey(english: string) { return createHash("sha256").update(english).digest("hex"); }
export function agreementLegalTexts(snapshot: unknown): string[] {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return [];
  const value = snapshot as Record<string,unknown>;
  return [value.termination,value.autoRenew].flatMap(section => {
    if (!section || typeof section !== "object" || Array.isArray(section)) return [];
    const text = (section as Record<string,unknown>).termsText;
    return typeof text === "string" && text.trim() ? [text] : [];
  });
}
export async function legalTranslationSources(): Promise<Map<string,string>> {
  const [agreements, versions] = await Promise.all([
    prisma.rentalAgreement.findMany({select:{termsSnapshot:true}}),
    prisma.monthToMonthTermsVersion.findMany({select:{termsText:true}}),
  ]);
  const texts = [...agreements.flatMap(row => agreementLegalTexts(row.termsSnapshot)), ...versions.map(row=>row.termsText)];
  return new Map(texts.filter(text=>text.trim()).map(text=>[legalSourceKey(text),text]));
}
export async function agreementLanguage(preference: CustomerLanguage, texts: string[]) {
  const { displayCustomerLanguage } = await import("./review");
  const language = await displayCustomerLanguage(preference);
  if (language === "en") return {language,digest:null,translations:[] as Array<{english:string;spanish:string}>};
  const { approvedSpanishSnapshot, translationFromSnapshot } = await import("./runtime");
  const {sources,digest} = await approvedSpanishSnapshot();
  try {
    return {language,digest,translations:texts.map(english=>({english,spanish:translationFromSnapshot(sources,"LEGAL",legalSourceKey(english),english)}))};
  } catch {
    // An old/custom snapshot without its exact reviewed counterpart renders wholly in English.
    return {language:"en" as const,digest:null,translations:[] as Array<{english:string;spanish:string}>};
  }
}
