import { createHash } from "node:crypto";
import {
  MANDATORY_CHARGE_KINDS, readMandatoryChargeHistory,
} from "./mandatory-charge-review";
import { readCommercialReserveHistory } from "@/domains/estimates/commercial-reserve-policy";

export const SIGNING_V2_CATEGORIES = [
  "ADMINISTRATIVE_SETUP", "DELIVERY", "INSTALLATION", "REMOVAL", "DAMAGE_WAIVER",
  "FIRST_MONTH_RENT_ADVANCE", "COMMERCIAL_RESERVE", "RETAIL_DELIVERY_FEE",
] as const;
export type SigningV2Category = typeof SIGNING_V2_CATEGORIES[number];
export type SigningV2Component = {
  id: string; category: SigningV2Category; amountCents: number;
  disposition: "DUE_NOW" | "NOT_APPLICABLE" | "BUSINESS_PAID";
  sourceFingerprint: string; sourceRevision: number;
  reason: string | null; termsReference: string | null;
};
export type SigningV2TaxLine = {
  componentId: string; jurisdictionId: string; rateVersionId: string;
  category: string; taxableCents: number; exemptCents: number; taxCents: number;
};
export type SigningV2Extension = {
  components: SigningV2Component[]; taxLines: SigningV2TaxLine[];
  ownerPolicyRevision: number; mandatoryReviewRevision: number;
  mandatoryReviewFingerprint: string; reserveTermsRevision: number | null;
  reserveTermsReference: string | null;
};
const cents = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000_000;
const sha = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const sort = <T>(rows: readonly T[], key: (row: T) => string): T[] =>
  [...rows].sort((a, b) => key(a).localeCompare(key(b)));
const sum = (values: readonly number[]) => {
  let result = 0;
  for (const n of values) {
    if (!cents(n) || !cents(result + n)) throw new Error("Signing V2 financial amount overflow.");
    result += n;
  }
  return result;
};
export function canonicalSigningV2Extension(value: SigningV2Extension): SigningV2Extension {
  return {
    components: sort(value.components, row => row.id).map(row=>({
      id:row.id,category:row.category,amountCents:row.amountCents,disposition:row.disposition,
      sourceFingerprint:row.sourceFingerprint,sourceRevision:row.sourceRevision,reason:row.reason,termsReference:row.termsReference,
    })),
    taxLines: sort(value.taxLines, row =>
      JSON.stringify([row.componentId, row.jurisdictionId, row.rateVersionId, row.category])).map(row=>({
        componentId:row.componentId,jurisdictionId:row.jurisdictionId,rateVersionId:row.rateVersionId,
        category:row.category,taxableCents:row.taxableCents,exemptCents:row.exemptCents,taxCents:row.taxCents,
      })),
    ownerPolicyRevision:value.ownerPolicyRevision,mandatoryReviewRevision:value.mandatoryReviewRevision,
    mandatoryReviewFingerprint:value.mandatoryReviewFingerprint,reserveTermsRevision:value.reserveTermsRevision,
    reserveTermsReference:value.reserveTermsReference,
  };
}
export function verifySigningV2Extension(value: SigningV2Extension, input: {
  agreementId: string; setupFeeCents: number; downPaymentCents: number;
  setupTaxCents: number; allInCents: number;
}): SigningV2Extension {
  if (!value || typeof value !== "object" || !input.agreementId || ![input.setupFeeCents, input.downPaymentCents,
      input.setupTaxCents, input.allInCents].every(cents) ||
      !Array.isArray(value.components) ||
      value.components.length !== SIGNING_V2_CATEGORIES.length ||
      !Array.isArray(value.taxLines) || value.taxLines.length > 1000 ||
      !Number.isSafeInteger(value.ownerPolicyRevision) || value.ownerPolicyRevision < 1 ||
      !Number.isSafeInteger(value.mandatoryReviewRevision) || value.mandatoryReviewRevision < 1 ||
      !sha(value.mandatoryReviewFingerprint) ||
      (value.reserveTermsRevision !== null &&
        (!Number.isSafeInteger(value.reserveTermsRevision) || value.reserveTermsRevision < 1)) ||
      (value.reserveTermsReference !== null &&
        (typeof value.reserveTermsReference !== "string" || value.reserveTermsReference.trim().length < 12)))
    throw new Error("Incomplete V2 reviewed signing charge sources.");
  const expected = new Set<string>(SIGNING_V2_CATEGORIES);
  const ids = new Set<string>();
  for (const item of value.components) {
    if (!item || typeof item !== "object" || !expected.delete(item.category) ||
        item.id !== input.agreementId + ":" + item.category || ids.has(item.id) ||
        !cents(item.amountCents) || !sha(item.sourceFingerprint) ||
        !Number.isSafeInteger(item.sourceRevision) || item.sourceRevision < 1 ||
        !["DUE_NOW", "NOT_APPLICABLE", "BUSINESS_PAID"].includes(item.disposition) ||
        (item.disposition !== "DUE_NOW" && item.amountCents !== 0) ||
        (item.reason !== null &&
          (typeof item.reason !== "string" || item.reason.length > 500)) ||
        (item.termsReference !== null &&
          (typeof item.termsReference !== "string" || item.termsReference.trim().length < 12 ||
            item.termsReference.length > 500)))
      throw new Error("Signing V2 contains invalid or duplicated money components.");
    ids.add(item.id);
  }
  if (expected.size) throw new Error("Signing V2 omitted a mandatory category.");
  const byCategory = new Map(value.components.map(row => [row.category, row]));
  const reserve = byCategory.get("COMMERCIAL_RESERVE")!;
  if (reserve.amountCents > 0 && (!value.reserveTermsRevision || !value.reserveTermsReference ||
      reserve.sourceRevision !== value.reserveTermsRevision ||
      reserve.termsReference !== value.reserveTermsReference))
    throw new Error("Signing V2 reserve requires the exact immutable negotiated terms.");
  if (byCategory.get("ADMINISTRATIVE_SETUP")?.amountCents !== input.setupFeeCents ||
      byCategory.get("FIRST_MONTH_RENT_ADVANCE")?.amountCents !== input.downPaymentCents ||
      byCategory.get("COMMERCIAL_RESERVE")?.disposition === "BUSINESS_PAID")
    throw new Error("Signing V2 scalar and component amounts differ.");
  const taxIds = new Set<string>();
  for (const row of value.taxLines) {
    if (!row || typeof row !== "object")
      throw new Error("Signing V2 tax evidence is incomplete or duplicated.");
    const id = JSON.stringify([row.componentId, row.jurisdictionId, row.rateVersionId, row.category]);
    const item = value.components.find(v => v.id === row.componentId);
    const taxCategory = item?.category === "ADMINISTRATIVE_SETUP" ? "ADMINISTRATIVE_SETUP" :
      item?.category === "FIRST_MONTH_RENT_ADVANCE" ? "RENTAL" :
      item?.category === "COMMERCIAL_RESERVE" ? null :
      item?.category === "DAMAGE_WAIVER" ? "DAMAGE_WAIVER" :
      item?.category === "DELIVERY" ? "DELIVERY" :
      item?.category === "INSTALLATION" ? "INSTALLATION" :
      item?.category === "REMOVAL" ? "REMOVAL" : null;
    if (!item || !taxCategory || row.category !== taxCategory ||
        typeof row.jurisdictionId !== "string" || !row.jurisdictionId ||
        typeof row.rateVersionId !== "string" || !row.rateVersionId ||
        taxIds.has(id) || ![row.taxableCents, row.exemptCents, row.taxCents].every(cents) ||
        row.taxableCents + row.exemptCents !== item.amountCents ||
        item.disposition !== "DUE_NOW")
      throw new Error("Signing V2 tax evidence is incomplete or duplicated.");
    taxIds.add(id);
  }
  const setupId = byCategory.get("ADMINISTRATIVE_SETUP")!.id;
  if (sum(value.taxLines.filter(row => row.componentId === setupId).map(row => row.taxCents)) !==
      input.setupTaxCents)
    throw new Error("Signing V2 setup tax differs from preserved scalar.");
  if (sum([...value.components.filter(row => row.disposition === "DUE_NOW").map(row => row.amountCents),
      ...value.taxLines.map(row => row.taxCents)]) !== input.allInCents)
    throw new Error("Signing V2 money does not reconcile.");
  return canonicalSigningV2Extension(value);
}
const category = {
  delivery: "DELIVERY", installation: "INSTALLATION", removal: "REMOVAL",
  damageWaiver: "DAMAGE_WAIVER",
} as const;

/** Build only from validated, owner-attributed, persisted version histories. */
export function buildSigningV2Extension(input: {
  agreementId: string; serviceAddressId: string; estimateId: string;
  setupFeeCents: number; downPaymentCents: number; setupTaxCents: number;
  setupJurisdictions: readonly {
    jurisdictionId: string; rateVersionId: string;
    taxableCents: number; exemptCents: number; taxCents: number;
  }[];
  depositCents: number; mandatoryHistory: unknown; reserveHistory: unknown;
  policyRevision: number; settingsUpdatedAt: string;
  expectedReviewRevision?: number;
  expectedReserveRevision?: number | null;
}): { extension: SigningV2Extension; allInCents: number } {
  const history = readMandatoryChargeHistory(input.mandatoryHistory);
  const review = input.expectedReviewRevision === undefined ? history.at(-1) :
    history.find(row => row.revision === input.expectedReviewRevision);
  if (!review || review.estimateId !== input.estimateId ||
      review.agreementId !== input.agreementId ||
      review.serviceAddressId !== input.serviceAddressId ||
      review.globalPolicyRevision !== input.policyRevision ||
      review.settingsUpdatedAt !== input.settingsUpdatedAt ||
      review.tax.status !== "VERIFIED" || review.tax.reasons.length ||
      review.tax.taxCents === null ||
      review.retailDelivery.status === "UNDECIDED" ||
      review.retailDelivery.amountCents === null ||
      review.retailDelivery.handling === "UNDECIDED" ||
      review.reserveCents !== input.depositCents ||
      review.charges.length !== MANDATORY_CHARGE_KINDS.length)
    throw new Error("A location requires complete reviewed service, RDF and tax sources.");
  const reserveHistory = readCommercialReserveHistory(input.reserveHistory);
  const reserve = input.expectedReserveRevision === undefined ?
    reserveHistory.at(-1) : input.expectedReserveRevision === null ?
      undefined : reserveHistory.find(row => row.revision === input.expectedReserveRevision);
  if (input.depositCents > 0 &&
      (!reserve || reserve.agreementId !== input.agreementId ||
        reserve.estimateId !== input.estimateId ||
        reserve.amountCents !== input.depositCents ||
        reserve.revision !== review.reserveRevision))
    throw new Error("Commercial reserve lacks the exact negotiated owner terms.");
  if (reserve && (reserve.amountCents !== input.depositCents ||
      reserve.revision !== review.reserveRevision))
    throw new Error("The reviewed reserve history and service policy disagree.");
  const component = (
    kind: SigningV2Category, amountCents: number,
    sourceFingerprint: string, sourceRevision: number,
    reason: string | null, termsReference: string | null = null,
    disposition: SigningV2Component["disposition"] =
      amountCents > 0 ? "DUE_NOW" : "NOT_APPLICABLE",
  ): SigningV2Component => ({
    id: input.agreementId + ":" + kind, category: kind, amountCents,
    disposition, sourceFingerprint, sourceRevision, reason, termsReference,
  });
  const setupSource = createHash("sha256").update(JSON.stringify({
    estimateId: input.estimateId, agreementId: input.agreementId,
    setupFeeCents: input.setupFeeCents, downPaymentCents: input.downPaymentCents,
    jurisdictions: sort(input.setupJurisdictions, row => row.jurisdictionId + row.rateVersionId)
      .map(row=>({jurisdictionId:row.jurisdictionId,rateVersionId:row.rateVersionId,
        taxableCents:row.taxableCents,exemptCents:row.exemptCents,taxCents:row.taxCents})),
  })).digest("hex");
  const components: SigningV2Component[] = [
    component("ADMINISTRATIVE_SETUP", input.setupFeeCents, setupSource, 1, null),
    component("FIRST_MONTH_RENT_ADVANCE", input.downPaymentCents, setupSource, 1, null),
    ...review.charges.map(charge => component(category[charge.kind], charge.amountCents,
      review.sourceFingerprint, review.revision, charge.reason)),
    component("COMMERCIAL_RESERVE", input.depositCents,
      reserve ? createHash("sha256").update(JSON.stringify({
        schemaVersion:reserve.schemaVersion,revision:reserve.revision,
        agreementId:reserve.agreementId,estimateId:reserve.estimateId,amountCents:reserve.amountCents,
        replenishment:reserve.replenishment,termsReference:reserve.termsReference,
        reason:reserve.reason,approvedByUserId:reserve.approvedByUserId,
        recordedAt:reserve.recordedAt,professionalReview:reserve.professionalReview,
      })).digest("hex") :
        review.sourceFingerprint, reserve?.revision ?? review.revision,
      null, reserve?.termsReference ?? null),
    component("RETAIL_DELIVERY_FEE",
      review.retailDelivery.status === "APPLIES" &&
        review.retailDelivery.handling === "COLLECT_FROM_CUSTOMER"
        ? review.retailDelivery.amountCents : 0,
      review.sourceFingerprint, review.revision, review.retailDelivery.reason, null,
      review.retailDelivery.status === "APPLIES" &&
        review.retailDelivery.handling === "PAY_MYSELF" ? "BUSINESS_PAID" :
        review.retailDelivery.status === "APPLIES" ? "DUE_NOW" : "NOT_APPLICABLE"),
  ];
  if (sum(review.tax.lines.map(row => row.taxCents)) !== review.tax.taxCents)
    throw new Error("Reviewed service tax total differs from its jurisdiction lines.");
  const taxLines: SigningV2TaxLine[] = [
    ...input.setupJurisdictions.map(row => ({
      componentId: input.agreementId + ":ADMINISTRATIVE_SETUP",
      category: "ADMINISTRATIVE_SETUP", ...row,
    })),
    ...review.tax.lines.map(row => {
      const kind = row.lineKey.replace("mandatory:", "") as keyof typeof category;
      if (!(kind in category)) throw new Error("Service tax has an unknown charge category.");
      return {
        componentId: input.agreementId + ":" + category[kind],
        jurisdictionId: row.jurisdictionId, rateVersionId: row.rateVersionId,
        category: row.category, taxableCents: row.taxableCents,
        exemptCents: row.exemptCents, taxCents: row.taxCents,
      };
    }),
  ];
  const allInCents = sum([
    ...components.filter(row => row.disposition === "DUE_NOW").map(row => row.amountCents),
    ...taxLines.map(row => row.taxCents),
  ]);
  const extension = verifySigningV2Extension({
    components, taxLines, ownerPolicyRevision: input.policyRevision,
    mandatoryReviewRevision: review.revision,
    mandatoryReviewFingerprint: review.sourceFingerprint,
    reserveTermsRevision: reserve?.revision ?? null,
    reserveTermsReference: reserve?.termsReference ?? null,
  }, {
    agreementId: input.agreementId,
    setupFeeCents: input.setupFeeCents, downPaymentCents: input.downPaymentCents,
    setupTaxCents: input.setupTaxCents, allInCents,
  });
  return { extension, allInCents };
}
