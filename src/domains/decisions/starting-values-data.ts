import type { Prisma } from "@prisma/client";
import type { DecisionSourceRef } from "./registry";

/**
 * DEC-2: the researched starting value for every Decisions & reviews question. The values, the reasons and the
 * sources come from docs/research/2026-10-25-open-decisions.md (the one place they are written down); every source was
 * opened on 2026-10-25. Plain words only in `why`: statute and letter numbers live in `sources`.
 *
 * A value here is never an owner answer. It runs the app until Chris, his CPA, attorney or translator confirms it,
 * and the screens call it "Starting value — not confirmed". Questions Chris already answered (2026-10-13) are applied
 * as CONFIRMED because he did answer them.
 */
export type StartingValue = {
  value: Prisma.JsonValue;
  why: string;
  sources: DecisionSourceRef[];
  /** CONFIRMED for questions the owner already answered; otherwise a starting value. */
  kind?: "STARTING_VALUE_APPLIED" | "CONFIRMED";
};
export type NoSource = { noSource: string };

const CHECKED = "2026-10-25";
const src = (title: string, url: string): DecisionSourceRef => ({ title, url, checkedOn: CHECKED });

const RESEARCH = src("Research notes for this question (2026-10-25)", "docs/research/2026-10-25-open-decisions.md");
const DOR_LEASES = src("Colorado Department of Revenue — Sales & Use Tax Topics: Leases",
  "https://tax.colorado.gov/sales-use-tax-topics-leases");
const DOR_LEASES_PDF = src("Colorado Department of Revenue — Leases guide (revised July 2026)",
  "https://tax.colorado.gov/sites/default/files/documents/SUTT_Leases_Jul_2026.pdf");
const CRS_713 = src("Colorado law on short-term leases (C.R.S. 39-26-713, secondary copy)",
  "https://colorado.public.law/statutes/crs_39-26-713");
const DOR_FILING = src("Colorado Department of Revenue — Sales Tax Filing Information",
  "https://tax.colorado.gov/sales-tax-filing-information");
const DR0100 = src("Colorado sales tax return DR 0100 (2026)",
  "https://tax.colorado.gov/sites/default/files/documents/DR0100SS_2026.pdf");
const RDF_TOPIC = src("Colorado Department of Revenue — Retail Delivery Fees",
  "https://tax.colorado.gov/special-topics-retail-delivery-fees");
const RDF_RATES = src("Colorado Department of Revenue — Retail Delivery Fee Rates",
  "https://tax.colorado.gov/retail-delivery-fee-rates");
const GREELEY_TAX = src("City of Greeley — Sales Tax", "https://greeleyco.gov/Business/Business-Operations/Sales-Tax");
const GREELEY_UNREAD = src("Greeley's city code could not be opened on 2026-10-25; careful choice used",
  "docs/research/2026-10-25-open-decisions.md");
const ZONE_SPEC = src("Delivery zones design (service area map)", "docs/build-specs/screens/SERVICE-AREA-MAP.md");
const CHRIS_DEC = src("Chris approved this value (DECISIONS.md, 2026-10-25)", "docs/DECISIONS.md");

const chrisAnswer = (id: string): DecisionSourceRef => ({
  title: "Chris's answer (OWNER-INPUTS)", url: `docs/OWNER-INPUTS.md#${id.toLowerCase()}`, checkedOn: "2026-10-13",
});

const CAREFUL_GREELEY = "Greeley collects its own city tax and its code could not be read, so the careful choice is to " +
  "charge it: that can never leave tax uncollected. Your CPA, or one call to the Greeley Sales Tax Division, settles it.";

function stateCell(taxable: boolean, why: string, extra: DecisionSourceRef[] = []): StartingValue {
  return { value: taxable ? "TAXABLE" : "EXEMPT", why, sources: [DOR_LEASES, DOR_LEASES_PDF, ...extra, RESEARCH] };
}
function greeleyCell(): StartingValue {
  return { value: "TAXABLE", why: CAREFUL_GREELEY, sources: [GREELEY_TAX, GREELEY_UNREAD] };
}

const OPTIONAL_SEPARATE = "The state taxes lease payments \"including any associated charges\". Delivery and installation " +
  "are untaxed only when the customer can decline them and they are billed separately; here they come with the rental, " +
  "so the careful choice is to charge tax. Your CPA may find the true answer is lower.";

export const STARTING_VALUES: Record<string, StartingValue | NoSource> = {
  "IN-33-ELECTION": {
    value: "PAY_ON_ACQUISITION",
    why: "The normal rule is to pay sales tax when you buy each appliance. Collecting tax on rent instead needs the state's " +
      "permission filed before buying, which a new business hasn't done. Rent of 3 years or less is then not taxed by the state.",
    sources: [DOR_LEASES, DOR_LEASES_PDF, CRS_713, RESEARCH],
  },
  "IN-33-GREELEY": { value: "TAXABLE", why: CAREFUL_GREELEY, sources: [GREELEY_TAX, GREELEY_UNREAD] },

  "IN-34-ADMINISTRATIVE-SETUP-STATE": stateCell(true,
    "A setup fee that every rental must pay was ruled part of the lease charge for a similar documentation fee, " +
    "so it is taxed like the rent would be. This matches the setup-fee choice in Settings."),
  "IN-34-DELIVERY-STATE": stateCell(true, OPTIONAL_SEPARATE),
  "IN-34-INSTALLATION-STATE": stateCell(true, OPTIONAL_SEPARATE),
  "IN-34-REMOVAL-STATE": stateCell(true, OPTIONAL_SEPARATE),
  "IN-34-HAUL-AWAY-STATE": stateCell(true, OPTIONAL_SEPARATE),
  "IN-34-DAMAGE-WAIVER-STATE": stateCell(true,
    "The state counts charges that come with a lease as part of the lease payment, so the damage waiver is taxed " +
    "until your CPA says otherwise."),
  "IN-34-EARLY-TERMINATION-STATE": stateCell(true,
    "A fee for ending a lease early is a charge connected to the lease, so the careful choice is to tax it."),
  "IN-34-LATE-PAYMENT-FEE-STATE": stateCell(false,
    "A late fee that is stated separately on the bill is not a charge for the use of the appliance, so the state does not tax it."),
  "IN-34-OTHER-CHARGE-STATE": stateCell(true,
    "No source covers other charges on a bill, so the most careful choice is used: tax them. Your CPA can narrow this."),
  "IN-34-MERCHANDISE-STATE": stateCell(true, "Parts and items sold to a customer are ordinary retail sales, which are taxed."),
  "IN-34-USED-APPLIANCE-SALE-STATE": stateCell(true, "Used appliances sold to a customer are ordinary retail sales, which are taxed."),

  "IN-34-ADMINISTRATIVE-SETUP-GREELEY": greeleyCell(),
  "IN-34-LATE-RETURN-GREELEY": greeleyCell(),
  "IN-34-DELIVERY-GREELEY": greeleyCell(),
  "IN-34-INSTALLATION-GREELEY": greeleyCell(),
  "IN-34-REMOVAL-GREELEY": greeleyCell(),
  "IN-34-HAUL-AWAY-GREELEY": greeleyCell(),
  "IN-34-DAMAGE-WAIVER-GREELEY": greeleyCell(),
  "IN-34-EARLY-TERMINATION-GREELEY": greeleyCell(),
  "IN-34-LATE-PAYMENT-FEE-GREELEY": greeleyCell(),
  "IN-34-OTHER-CHARGE-GREELEY": greeleyCell(),
  "IN-34-MERCHANDISE-GREELEY": greeleyCell(),
  "IN-34-USED-APPLIANCE-SALE-GREELEY": greeleyCell(),

  "IN-35-BASIS": {
    value: "ACCRUAL",
    why: "Reporting tax when a bill is sent never reports too little. The state sets how often you file from the tax you " +
      "collect; until the license shows it, monthly filing never misses a due date.",
    sources: [DOR_FILING, DR0100, RESEARCH],
  },
  "IN-37-RDF": {
    value: "PAY_MYSELF",
    why: "Paying any delivery fee yourself avoids the rule that collected fees must be sent to the state and cannot be refunded. " +
      "The fee rate is $0.31 from 1 July 2026 to 30 June 2027.",
    sources: [RDF_TOPIC, RDF_RATES, RESEARCH],
  },
  "IN-37-RDF-OWED": {
    value: "NOT_LIABLE",
    why: "Short-term leases without the state's permission owe no retail delivery fee, and a new business with no Colorado " +
      "retail sales last year is exempt until its sales pass $500,000 a year.",
    sources: [RDF_TOPIC, RDF_RATES, RESEARCH],
  },
  "IN-39-BADDEBT": {
    value: "NO",
    why: "Taking back tax on written-off bills has conditions the sources did not settle, and it does not apply when tax is reported " +
      "when paid. Saying no never under-pays.",
    sources: [DR0100, RESEARCH],
  },
  "IN-79": {
    value: "TAXABLE",
    why: "A documentation fee was ruled inseparable from the lease, and the setup fee is the same kind of charge. This matches " +
      "the value already planned in Settings.",
    sources: [DOR_LEASES, RESEARCH],
  },
  "IN-71": {
    value: 7,
    why: "The state wants records 3 years after the return is due and the IRS until the limit for the year an asset is sold or " +
      "retired. Seven years after the appliance leaves the fleet covers both.",
    sources: [DOR_FILING, src("IRS Publication 946 (What's New)", "https://www.irs.gov/publications/p946"), RESEARCH],
  },
  "TRUSTED-DEVICE-DAYS": {
    value: 30,
    why: "Chris approved 30 days: long enough that a regular device isn't asked every week, short enough that a lost device stops working soon.",
    sources: [CHRIS_DEC],
  },
  "GREELEY-RATE-2F": {
    value: 4110,
    why: "Greeley's city rate is 4.11% in the city's own example. Ballot measure 2F (+0.6%) is on the 3 November 2026 ballot; " +
      "the rate stays 4.11% until the city publishes a new one.",
    sources: [GREELEY_TAX, RESEARCH],
  },

  "LATE-FEE-AMOUNT": {
    value: 500,
    why: "Chris answered $5 once per overdue bill, charged only after the bill is more than 10 days late and the customer was told, never more than $15.",
    sources: [chrisAnswer("IN-84")],
    kind: "CONFIRMED",
  },

  // Answers that follow what the app does today.
  "IN-44": asBuilt("Untaxed rent is included in gross sales and then subtracted on the deduction lines the return names. This is the more transparent way and does not change the tax due.", [DR0100, RESEARCH]),
  "IN-46": asBuilt("Parts and used appliances are taxed like other goods: the shop's rate when picked up, the customer's address rate when delivered. Stock for resale is bought with tax paid until the CPA says otherwise.", [DOR_LEASES, RESEARCH]),
  "IN-56": asBuilt("The remaining book value is written off once. The tax effect is shown only as an estimate for your CPA, never a made-up number.", [src("IRS Publication 946 (What's New)", "https://www.irs.gov/publications/p946"), RESEARCH]),
  "IN-65": asBuilt("Colorado use tax is reduced by tax legally paid to another state, never below zero. Greeley use tax is charged in full because its rules could not be read.", [src("Colorado Consumer Use Tax Guide (January 2026)", "https://tax.colorado.gov/sites/tax/files/documents/Consumer_Use_Tax_Guide_January_2026.pdf"), RESEARCH]),
  "IN-07": asBuilt("The legal business details and rental terms approved earlier stay as they are.", [src("Earlier approval (OWNER-INPUTS)", "docs/OWNER-INPUTS.md#in-07")]),
  "IN-21": asBuilt("The month-to-month wording built into the app, with 30 days' notice before a change.", [RESEARCH]),
  "IN-31": asBuilt("Notices go by mail, email to the customer's own mailbox, a handed copy, or text/app only with text permission. A phone call does not count.", [RESEARCH]),
  "IN-38": asBuilt("Agreements say \"Sales tax for your address, currently {rate}%\" instead of a fixed rate, so they stay right when rates change.", [RESEARCH]),

  // Questions Chris already answered on 2026-10-13: applied as confirmed.
  "IN-84": answered("IN-84", "A $5 flat late fee, once per overdue bill, only after the bill is more than 10 days late and the customer was told, at most $15. The owner or an admin may waive it with a reason."),
  "IN-06": answered("IN-06", "Delivery up to 15 miles free, over 15 to 30 miles $75, over 30 to 50 miles $125, beyond 50 miles not delivered."),
  "IN-76": answered("IN-76", "Full refund before delivery; larger orders get a full refund within 72 hours, then the setup fee is kept. Every refund needs the owner's approval."),
  "IN-52": answered("IN-52", "The voicemail greeting can be edited, recordings are kept 90 days, and transcription is off."),
  "IN-78": answered("IN-78", "The property-manager rules Chris answered."),
  "IN-83": answered("IN-83", "Spanish wording is reviewed by fluent people Chris knows before it is used."),
  // ZONE-1 (docs/build-specs/screens/SERVICE-AREA-MAP.md).
  "ZONE-NAMES": asBuilt("Plain names that say what each zone means to a customer: the first one says delivery is free, " +
    "and the other two say how far out the address is. They can be renamed any time without changing any price.",
    [ZONE_SPEC]),
  "ZONE-PICKUP-PRICE": asBuilt("Picking the machines up at the end is the same trip as bringing them, so it starts at the " +
    "same price in each zone (free, $75, $125). It is charged only when the rental ends, and only for later rentals.",
    [ZONE_SPEC, chrisAnswer("IN-06")]),
  "ZONE-DISTANCE": { value: "AS_BUILT", why: "Chris chose a straight line from the center of Greeley on 2026-10-25, at " +
    "least for now: it needs no paid route service and every customer at the same distance pays the same.",
    sources: [CHRIS_DEC, ZONE_SPEC], kind: "CONFIRMED" },
};

function asBuilt(why: string, sources: DecisionSourceRef[]): StartingValue {
  return { value: "AS_BUILT", why, sources };
}
function answered(id: string, why: string): StartingValue {
  return { value: "AS_BUILT", why, sources: [chrisAnswer(id)], kind: "CONFIRMED" };
}

export function isNoSource(entry: StartingValue | NoSource): entry is NoSource {
  return "noSource" in entry;
}
