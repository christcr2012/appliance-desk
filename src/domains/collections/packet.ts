// OPS-6: the small-claims packet. Everything Chris needs to fill in the court's claim form and to prove the claim:
// the ledger, the signed agreement, the notices that were sent, and what the appliance cost. Chris files it himself;
// the app never files anything. The court's own claim form (JDF 250, "Notice, Claim and Summons") is attached by Chris
// from the Colorado Judicial Branch site, so it is always the current one.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { ruleAsOf } from "@/domains/rules/reads";
import { COLLECTION_BUSINESS_NAME } from "./templates";
import {
  filingCounts, filingRoom, smallClaimsEligible, smallClaimsFee, type FilingLimits, type SmallClaimsFees,
} from "./rules";

export const COURT_FORM_NAME = "JDF 250, Notice, Claim and Summons";
export const COURT_FORMS_URL = "https://coloradojudicial.gov/es/topic/193";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const day = (d: Date | null | undefined) => d ? d.toLocaleDateString("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric" }) : "—";

export function denverYearMonth(date: Date): { y: number; m: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", year: "numeric", month: "numeric" }).formatToParts(date);
  return { y: Number(parts.find((p) => p.type === "year")!.value), m: Number(parts.find((p) => p.type === "month")!.value) };
}

export type SmallClaimsFacts = {
  agreementId: string;
  customerName: string;
  owedCents: number;
  ledger: { invoiceNumber: number; dueOn: Date | null; amountDueCents: number; amountPaidCents: number; payments: { at: Date; amountCents: number; method: string | null }[] }[];
  notices: { kind: string; sentAt: Date | null }[];
  appliances: { label: string; costCents: number | null }[];
  agreementSignedAt: Date | null;
  agreementStart: Date | null;
  defendantAddress: string[];
  eligible: { ok: boolean; reason: string | null };
  feeCents: number;
  limitCents: number;
  county: string | null;
  filingNote: string | null;
};

export async function gatherSmallClaimsFacts(agreementId: string, county: string | null, now = new Date()): Promise<SmallClaimsFacts> {
  const agreement = await prisma.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
    select: {
      id: true, startDate: true, customerId: true,
      customer: { select: { user: { select: { name: true } } } },
      serviceAddress: { select: { line1: true, line2: true, city: true, state: true, zip: true } },
    },
  });
  const [signature, invoices, steps, custody] = await Promise.all([
    prisma.signatureRecord.findUnique({ where: { agreementId }, select: { signedAt: true } }),
    prisma.invoice.findMany({
      where: { agreementId, status: { in: ["OPEN", "PARTIALLY_PAID", "DELINQUENT", "PAID"] } },
      orderBy: { invoiceNumber: "asc" },
      select: { invoiceNumber: true, dueDate: true, amountDueCents: true, amountPaidCents: true, status: true, payments: { where: { status: { not: "failed" } }, orderBy: { createdAt: "asc" }, select: { createdAt: true, amountCents: true, method: true } } },
    }),
    prisma.collectionStep.findMany({ where: { invoice: { agreementId }, kind: { in: ["SECOND_NOTICE", "FINAL_NOTICE"] }, state: "SENT" }, select: { kind: true, decidedAt: true } }),
    prisma.applianceCustodyEpisode.findMany({ where: { agreementId, endedOn: null }, select: { appliance: { select: { assetNumber: true, manufacturer: true, model: true, acquisitionCostCents: true } } } }),
  ]);
  const owedCents = invoices.filter((i) => i.status !== "PAID").reduce((sum, i) => sum + Math.max(0, i.amountDueCents - i.amountPaidCents), 0);
  const limit = (await ruleAsOf<number>("co.small_claims_limit", now)).value;
  const fees = (await ruleAsOf<SmallClaimsFees>("co.small_claims_fees", now)).value;
  const limits = (await ruleAsOf<FilingLimits>("co.small_claims_filing_limits", now)).value;
  const eligible = smallClaimsEligible(owedCents, limit);
  let filingNote: string | null = null;
  let ok = eligible.ok;
  let reason = eligible.reason;
  if (county) {
    const filings = await prisma.smallClaimsFiling.findMany({ where: { filedOn: { gte: new Date(now.getTime() - 400 * 86_400_000) } }, select: { county: true, filedOn: true } });
    const room = filingRoom(filingCounts(filings, county, now, denverYearMonth), limits);
    filingNote = room.message;
    if (!room.ok && ok) { ok = false; reason = room.message; }
  }
  const a = agreement.serviceAddress;
  return {
    agreementId,
    customerName: agreement.customer.user.name ?? "Customer",
    owedCents,
    ledger: invoices.map((i) => ({ invoiceNumber: i.invoiceNumber, dueOn: i.dueDate, amountDueCents: i.amountDueCents, amountPaidCents: i.amountPaidCents, payments: i.payments.map((p) => ({ at: p.createdAt, amountCents: p.amountCents, method: p.method })) })),
    notices: steps.map((s) => ({ kind: s.kind, sentAt: s.decidedAt })),
    appliances: custody.map((c) => ({ label: [c.appliance.assetNumber, c.appliance.manufacturer, c.appliance.model].filter(Boolean).join(" "), costCents: c.appliance.acquisitionCostCents })),
    agreementSignedAt: signature?.signedAt ?? null,
    agreementStart: agreement.startDate,
    defendantAddress: a ? [a.line1, a.line2, `${a.city}, ${a.state} ${a.zip}`].filter((x): x is string => Boolean(x)) : [],
    eligible: { ok, reason },
    feeCents: smallClaimsFee(owedCents, fees),
    limitCents: limit,
    county,
    filingNote,
  };
}

export async function renderSmallClaimsPacket(facts: SmallClaimsFacts, now = new Date()): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([612, 792]);
  let y = 750;
  const clean = (t: string) => t.replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
  const line = (text: string, size = 10, b = false) => {
    const f = b ? bold : font;
    const words = clean(text).split(/\s+/);
    let cur = "";
    const flush = () => {
      if (y < 60) { page = pdf.addPage([612, 792]); y = 750; }
      page.drawText(cur, { x: 50, y, size, font: f, color: rgb(0, 0, 0) });
      y -= size + 4;
    };
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(next, size) > 510) { flush(); cur = w; } else cur = next;
    }
    if (cur) flush();
  };
  const gap = () => { y -= 8; };

  line(`${COLLECTION_BUSINESS_NAME} — small-claims packet`, 15, true);
  line(`Prepared ${day(now)} for ${facts.customerName}. This is a working summary for filing; Chris files it himself.`);
  gap();
  line("Claim", 12, true);
  line(`Amount owed: ${money(facts.owedCents)}   (small-claims limit ${money(facts.limitCents)}; filing fee ${money(facts.feeCents)})`);
  if (!facts.eligible.ok && facts.eligible.reason) line(`NOT READY: ${facts.eligible.reason}`, 10, true);
  if (facts.county) line(`County to file in: ${facts.county}. ${facts.filingNote ?? ""}`);
  line(`Where to file: the county where the customer lives or works, or where the property is.`);
  gap();
  line("Defendant", 12, true);
  line(facts.customerName);
  for (const l of facts.defendantAddress) line(l);
  gap();
  line("Agreement", 12, true);
  line(`Signed ${day(facts.agreementSignedAt)}; rental started ${day(facts.agreementStart)}. Print the signed agreement from the customer's account and attach it behind this summary.`);
  gap();
  line("Bills and payments", 12, true);
  for (const bill of facts.ledger) {
    line(`Bill #${bill.invoiceNumber}  due ${day(bill.dueOn)}  billed ${money(bill.amountDueCents)}  paid ${money(bill.amountPaidCents)}  still owed ${money(Math.max(0, bill.amountDueCents - bill.amountPaidCents))}`, 10, true);
    for (const p of bill.payments) line(`    paid ${money(p.amountCents)} on ${day(p.at)}${p.method ? ` (${p.method})` : ""}`);
  }
  gap();
  line("Notices sent to the customer", 12, true);
  if (facts.notices.length === 0) line("None recorded.");
  for (const n of facts.notices) line(`${n.kind === "FINAL_NOTICE" ? "Final notice" : "Second notice"} sent ${day(n.sentAt)}`);
  gap();
  line("Appliance at the customer's", 12, true);
  if (facts.appliances.length === 0) line("None on record.");
  for (const a of facts.appliances) line(`${a.label}: we paid ${a.costCents === null ? "(not recorded)" : money(a.costCents)} (cost, not today's market value)`);
  gap();
  line("Court form", 12, true);
  line(`Fill in ${COURT_FORM_NAME} from ${COURT_FORMS_URL} (always use the current copy), attach this packet, and take or send it to the clerk with the filing fee. After you file, record it in the app so the court's monthly and yearly limits stay counted.`);
  return pdf.save();
}
