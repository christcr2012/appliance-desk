import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { NOTICE_COPY, NOTICE_WRAPPER_COPY, type NoticeCopyKey } from "./notice-copy";
import { formatCents } from "@/domains/pricing/money";
import { formatBusinessDate } from "@/lib/business-date";
import type { AnnualReminderInput } from "@/domains/notices/annual-reminder";
import type { RenewalReminderInput } from "@/domains/notices/renewal-reminder";
import type { TermsChangeInput } from "@/domains/notices/terms-change";

export async function currentNoticeSources() {
  const settings = await prisma.businessSettings.findUnique({where:{id:"singleton"},select:{annualReminderText:true,termsChangeNoticeText:true}});
  return {...NOTICE_COPY.en,
    "annual:body":settings?.annualReminderText?.trim() || NOTICE_COPY.en["annual:body"],
    "change:body":settings?.termsChangeNoticeText?.trim() || NOTICE_COPY.en["change:body"],
  };
}
type NoticeText = {subject:string;body:string;language?:"en"|"es";translationCopyDigest?:string};
async function localize(tx: Prisma.TransactionClient, customerId:string, kind:"annual"|"change"|"renewal", original:NoticeText,
  englishBody:string, values:Record<string,string>):Promise<NoticeText> {
  const { allSpanishSurfacesReady } = await import("./readiness");
  if (!allSpanishSurfacesReady) return original;
  const customer = await tx.customer.findUnique({where:{id:customerId},select:{preferredLanguage:true,archivedAt:true}});
  if (customer?.preferredLanguage !== "es" || customer.archivedAt) return original;
  const {approvedSpanishSources,translationFromSnapshot} = await import("./runtime");
  const { reviewedCopyDigest } = await import("./review");
  const {legalSourceKey} = await import("./legal");
  const sources = await approvedSpanishSources();
  if (!sources.length) return original;
  try {
  const subjectKey = `${kind}:subject` as NoticeCopyKey;
  const bodyKey = `${kind}:body` as NoticeCopyKey;
  const subjectTemplate = translationFromSnapshot(sources,"NOTICE",subjectKey,NOTICE_COPY.en[subjectKey]);
  const bodyTemplate = translationFromSnapshot(sources,"NOTICE",bodyKey,englishBody);
  const translatedValues = {...values};
  if (values.terms) translatedValues.terms = translationFromSnapshot(sources,"LEGAL",legalSourceKey(values.terms),values.terms);
  const render = (template:string) => template.replace(/\{\{\s*([A-Za-z]+)\s*\}\}/g, (_match,name:string) => {
    if (!Object.hasOwn(translatedValues,name)) throw new Error("Missing notice translation variable");
    return translatedValues[name];
  });
  const body = render(bodyTemplate);
  return {subject:render(subjectTemplate),body:`${render(NOTICE_WRAPPER_COPY.greeting)}\n\n${body}${values.terms ? "\n\n" + NOTICE_WRAPPER_COPY.controlling + "\n" + values.terms : ""}`,
    language:"es",translationCopyDigest:reviewedCopyDigest(sources)};
  } catch {
    // A newly published/custom legal source may not yet have a reviewed counterpart.
    // Freeze the whole original English notice; never mix unreviewed Spanish with it.
    return original;
  }
}
export async function localizeAnnualNotice(tx:Prisma.TransactionClient,customerId:string,input:AnnualReminderInput,original:NoticeText) {
  return localize(tx,customerId,"annual",original,input.template?.trim() ? input.template : NOTICE_COPY.en["annual:body"],{
    ...common(input),customerName:input.customerName,noticeDays:String(input.noticeDays),boundaryDate:formatBusinessDate(input.boundary,"es"),years:String(input.years),monthlyTotal:formatCents(input.monthlyTotalCents),items:input.lineLabels.join(", "),
  });
}
export async function localizeRenewalNotice(tx:Prisma.TransactionClient,customerId:string,input:RenewalReminderInput,original:NoticeText) {
  return localize(tx,customerId,"renewal",original,NOTICE_COPY.en["renewal:body"],{
    ...common(input),customerName:input.customerName,termMonths:String(input.termMonths),endDate:formatBusinessDate(input.termEndDate,"es"),startDate:formatBusinessDate(input.renewalStartDate,"es"),monthlyTotal:formatCents(input.monthlyTotalCents),items:input.lineLabels.join(", "),terms:input.renewalTermsText.trim(),
  });
}
export async function localizeTermsNotice(tx:Prisma.TransactionClient,customerId:string,input:TermsChangeInput,original:NoticeText) {
  return localize(tx,customerId,"change",original,input.template?.trim() ? input.template : NOTICE_COPY.en["change:body"],{
    ...common(input),customerName:input.customerName,noticeDays:String(input.noticeDays),terms:input.termsText.trim(),effectiveDate:NOTICE_WRAPPER_COPY.effective.replace("{{days}}",String(input.changeDays)),
  });
}
function common(input:{businessName:string;businessPhone:string;businessEmail:string}) {
  return {businessName:input.businessName,businessPhone:input.businessPhone,businessEmail:input.businessEmail};
}
