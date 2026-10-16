import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const m = vi.hoisted(()=>({sources:vi.fn(),review:vi.fn()}));
vi.mock("@/domains/language/readiness",()=>({allSpanishSurfacesReady:true,CUSTOMER_SPANISH_SURFACE_READINESS:{}}));
vi.mock("@/domains/language/drafts",()=>({listCurrentTranslationDrafts:m.sources}));
vi.mock("@/lib/prisma",()=>({prisma:{customerLanguageReview:{findUnique:m.review}}}));
import type { TranslationSource } from "@/domains/language/drafts";
import { reviewedCopyDigest } from "@/domains/language/review";
import { TRANSACTIONAL_COPY, quoteEmailCopy } from "@/domains/language/transactional-copy";
import { approvedSpanishSnapshot, activeMessageCatalog, translationFromSnapshot } from "@/domains/language/runtime";
import { agreementLanguage, legalSourceKey } from "@/domains/language/legal";
import { NOTICE_COPY } from "@/domains/language/notice-copy";
import { localizeTermsNotice, localizeAnnualNotice } from "@/domains/language/notice-language";
import type { Prisma } from "@prisma/client";
function source(kind:TranslationSource["kind"],key:string,english:string,spanish:string):TranslationSource {
  return {kind,key,english,spanish,digest:createHash("sha256").update(english).digest("hex"),stale:false,revision:1};
}
let sources:TranslationSource[];
function approve() { m.sources.mockResolvedValue(sources);m.review.mockResolvedValue({copyDigest:reviewedCopyDigest(sources),reviewedAt:new Date(),legalReviewedAt:new Date(),publishedAt:new Date()}); }
beforeEach(()=>{vi.clearAllMocks();sources=Object.entries(TRANSACTIONAL_COPY.en).map(([key,english])=>source("MESSAGE",key,english,TRANSACTIONAL_COPY.es[key as keyof typeof TRANSACTIONAL_COPY.es]));approve();});
describe("W-26 reviewed owner text at actual rendering boundary",()=>{
  it("applies separately edited subject/body while preserving all money and link values",async()=>{
    sources.find(row=>row.key==="quoteSubject")!.spanish="Pedido n.º {{number}} de {{business}}";approve();
    const catalog=await activeMessageCatalog("es");
    const output=quoteEmailCopy("es",{businessName:"Test Rentals",estimateNumber:12,recipientName:"Ana",monthlyCents:6050,oneTimeCents:4500,fullyReviewed:true,clientMessage:null,url:"https://example.test/estimate/token"},catalog);
    expect(output.subject).toBe("Pedido n.º 12 de Test Rentals");
    expect(output.text).toContain("$60.50");expect(output.text).toContain("$45.00");expect(output.text).toContain("https://example.test/estimate/token");
    expect(output.text).not.toContain("{{");
  });
  it.each(["missing","stale","edited","unpublished","legal-revoked"])("fails closed for %s approval without silently using a partial Spanish catalog",async reason=>{
    if(reason==="missing") sources[0].spanish=null;
    if(reason==="stale") sources[0].stale=true;
    if(reason==="edited") sources[0].spanish="Changed after approval";
    if(reason==="unpublished") m.review.mockResolvedValue({copyDigest:reviewedCopyDigest(sources),reviewedAt:new Date(),legalReviewedAt:new Date(),publishedAt:null});
    if(reason==="legal-revoked") m.review.mockResolvedValue({copyDigest:reviewedCopyDigest(sources),reviewedAt:new Date(),publishedAt:new Date(),legalReviewedAt:null});
    expect((await approvedSpanishSnapshot()).digest).toBeNull();
    await expect(activeMessageCatalog("es")).rejects.toThrow("requires review");
    expect(await activeMessageCatalog("en")).toBe(TRANSACTIONAL_COPY.en);
  });
  it("refuses a translated template for a different English source",()=>{
    const rows=[source("COMMUNICATION","revision:body","Total {{amount}}","Importe {{amount}}")];
    expect(translationFromSnapshot(rows,"COMMUNICATION","revision:body","Total {{amount}}")).toBe("Importe {{amount}}");
    expect(()=>translationFromSnapshot(rows,"COMMUNICATION","revision:body","Updated {{amount}}")).toThrow("requires review");
  });
  it("returns legal text and fingerprint from the same approved snapshot",async()=>{
    const english="Synthetic English agreement terms.";
    sources.push(source("LEGAL",legalSourceKey(english),english,"Condiciones sintéticas del contrato."));approve();
    const result=await agreementLanguage("es",[english]);
    expect(result.language).toBe("es");expect(result.digest).toBe(reviewedCopyDigest(sources));
    expect(result.translations).toEqual([{english,spanish:"Condiciones sintéticas del contrato."}]);
    const missing=await agreementLanguage("es",["A different signed English snapshot."]);
    expect(missing.language).toBe("en");expect(missing.translations).toEqual([]);
  });
});
describe("W-26 new notice language and unchanged historical evidence",()=>{
  const input={customerName:"Ana",noticeDays:30,termsText:"Synthetic original English terms.",changeDays:30,businessName:"Test Rentals",businessPhone:"555-0100",businessEmail:"support@example.test"};
  const original={subject:"Original English subject",body:"Exact original English notice"};
  const tx={customer:{findUnique:vi.fn().mockResolvedValue({preferredLanguage:"es",archivedAt:null})}} as unknown as Prisma.TransactionClient;
  function noticeSources(){for(const [key,english] of Object.entries(NOTICE_COPY.en))sources.push(source("NOTICE",key,english,NOTICE_COPY.es[key as keyof typeof NOTICE_COPY.es]));}
  it("uses full English for a newly published legal source not yet reviewed",async()=>{
    noticeSources();approve();
    expect(await localizeTermsNotice(tx,"customer",input,original)).toEqual(original);
  });
  it("freezes a new Spanish notice with current digest and original governing terms",async()=>{
    noticeSources();sources.push(source("LEGAL",legalSourceKey(input.termsText),input.termsText,"Condiciones sintéticas originales en inglés."));approve();
    const output=await localizeTermsNotice(tx,"customer",input,original);
    expect(output.language).toBe("es");expect(output.translationCopyDigest).toBe(reviewedCopyDigest(sources));
    expect(output.body).toContain(input.termsText);expect(output.body).toContain("30 días");
    expect(output.body).not.toContain("{{");expect(original.body).toBe("Exact original English notice");
  });
  it("keeps annual dollar values identical and does not recalculate a billed amount",async()=>{
    noticeSources();approve();
    const output=await localizeAnnualNotice(tx,"customer",{...input,boundary:new Date("2027-10-01T12:00:00Z"),years:1,monthlyTotalCents:6050,lineLabels:["Recorded washer label"]},original);
    expect(output.body).toContain("$60.50");expect(output.body).toContain("Recorded washer label");expect(output.language).toBe("es");
  });
});
