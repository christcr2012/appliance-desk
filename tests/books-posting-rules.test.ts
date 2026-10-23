import { describe, expect, it } from "vitest";
import { InvoiceLineItemKind } from "@prisma/client";
import { SYSTEM_ACCOUNTS, DEFAULT_EXPENSE_CATEGORIES, lineKindAccountRole } from "@/domains/books/accounts";
import {
  PostingEvidenceError, balancedPlan, reversePlan, invoiceRecognition, invoiceVoided,
  receiptReceived, paymentApplied, depositFunded, creditIssued, creditApplied, refundIssued,
  depositRefunded, depositRetained, invoiceWrittenOff, stripeBalancePlans, expensePosted,
  expenseVoided, applianceContributed, depreciationAccrued, assetDisposedBeforeK6,
  useTaxAccrued, taxFiled, openingBalance, postingBusinessDate,
} from "@/domains/books/posting-rules";

const date = new Date("2026-10-17T22:00:00Z");
const cents = 5750;
const check = (plan: ReturnType<typeof balancedPlan>) => {
  expect(plan).not.toBeNull();
  const lines = plan!.lines;
  expect(lines.reduce((n, x) => n + x.debitCents, 0)).toBe(lines.reduce((n, x) => n + x.creditCents, 0));
  expect(lines.every(x => x.debitCents >= 0 && x.creditCents >= 0 && Number.isInteger(x.creditCents) &&
    Number.isInteger(x.debitCents) && !(x.debitCents && x.creditCents))).toBe(true);
};
describe("Batch K chart and pure posting", () => {
  it("has unique system roles and valid category mappings", () => {
    const names = SYSTEM_ACCOUNTS.map(x => x.role);
    expect(new Set(names).size).toBe(names.length);
    expect(DEFAULT_EXPENSE_CATEGORIES.length).toBe(16);
    expect(DEFAULT_EXPENSE_CATEGORIES.every(x => names.includes(x.role))).toBe(true);
  });
  it("maps every existing invoice item kind including newer fees", () => {
    for (const kind of Object.values(InvoiceLineItemKind)) expect(() => lineKindAccountRole(kind,100)).not.toThrow();
    expect(lineKindAccountRole("ADMIN_SETUP_FEE",500)).toBe("OTHER_INCOME");
    expect(lineKindAccountRole("RETAIL_DELIVERY_FEE",500)).toBe("RETAIL_DELIVERY_FEE_PAYABLE");
    expect(lineKindAccountRole("ADJUSTMENT",-100)).toBe("DISCOUNTS");
    expect(lineKindAccountRole("TAX",250)).toBe("TAX_LINES");
    expect(lineKindAccountRole("DEPOSIT",250)).toBe("SKIP");
  });
  it("posts a tax-split invoice including an RDF liability and reversible void", () => {
    const invoice = {
      status:"PAID" as const, createdAt:date, amountDueCents:11650,
      items:[{kind:"RENTAL" as const,amountCents:10000},{kind:"PREPAY_DISCOUNT" as const,amountCents:-1000},
        {kind:"RETAIL_DELIVERY_FEE" as const,amountCents:400}],
      taxes:[{filingAccountId:"co",taxCents:2250}],
    };
    const plan = invoiceRecognition(invoice);
    check(plan);
    expect(plan!.entryDate.toISOString()).toBe("2026-10-17T06:00:00.000Z");
    expect(plan!.lines).toContainEqual({role:"SALES_TAX:co",debitCents:0,creditCents:2250});
    expect(plan!.lines).toContainEqual({role:"DISCOUNTS",debitCents:1000,creditCents:0});
    check(invoiceVoided({...invoice,status:"VOID",voidedAt:date}));
    expect(() => invoiceRecognition({...invoice,amountDueCents:11649})).toThrow(PostingEvidenceError);
    expect(invoiceRecognition({...invoice,status:"DRAFT"})).toBeNull();
    expect(invoiceVoided({...invoice,status:"PAID"})).toBeNull();
  });
  it("books a refundable deposit on an invoice as money held, not income, and nets to zero once funded", () => {
    const invoice = {
      status:"OPEN" as const, createdAt:date, amountDueCents:10000 + 800 + 25000,
      items:[{kind:"RENTAL" as const,amountCents:10000},{kind:"DEPOSIT" as const,amountCents:25000}],
      taxes:[{filingAccountId:"co",taxCents:800}],
    };
    const recognized = invoiceRecognition(invoice)!;
    check(recognized);
    expect(recognized.lines).toContainEqual({role:"RECEIVABLES",debitCents:35800,creditCents:0});
    expect(recognized.lines).toContainEqual({role:"UNAPPLIED_RECEIPTS",debitCents:0,creditCents:25000});
    expect(recognized.lines.some(l => l.role === "DEPOSITS_HELD")).toBe(false);
    // The whole life of it: bill, money in, money applied to the bill, deposit moved to Deposits held.
    const plans = [recognized, receiptReceived({date,amountCents:35800,method:"STRIPE"})!,
      paymentApplied({date,amountCents:35800,receiptId:"r1",moneyArrived:true})!,
      depositFunded({date,amountCents:25000,sourceReceiptId:"r1"})!];
    const net = new Map<string, number>();
    for (const plan of plans) for (const l of plan.lines) net.set(l.role, (net.get(l.role) ?? 0) + l.debitCents - l.creditCents);
    expect(net.get("RECEIVABLES")).toBe(0);
    expect(net.get("UNAPPLIED_RECEIPTS")).toBe(0);
    expect(net.get("DEPOSITS_HELD")).toBe(-25000);
    expect(net.get("STRIPE_CLEARING")).toBe(35800);
    check(invoiceVoided({...invoice,status:"VOID",voidedAt:date}));
    expect(() => invoiceRecognition({...invoice,amountDueCents:10800})).toThrow(PostingEvidenceError);
    expect(() => invoiceRecognition({...invoice,items:[{kind:"RENTAL" as const,amountCents:10000},{kind:"DEPOSIT" as const,amountCents:-5}],amountDueCents:10795})).toThrow(PostingEvidenceError);
  });
  it("refuses unbalanced, fractional, invalid or unsupported evidence", () => {
    expect(() => balancedPlan(date,"bad",[{role:"BANK",debitCents:1,creditCents:0}])).toThrow(PostingEvidenceError);
    expect(() => balancedPlan(date,"both",[{role:"BANK",debitCents:1,creditCents:1}])).toThrow(PostingEvidenceError);
    expect(() => balancedPlan(date,"invalid",[{role:"BANK",debitCents:-1,creditCents:0}])).toThrow(PostingEvidenceError);
    expect(() => receiptReceived({date,amountCents:0.5,method:"STRIPE"})).toThrow(PostingEvidenceError);
    expect(() => assetDisposedBeforeK6()).toThrow(/K-6/);
  });
  it("balances all funded, applied and credited receipts without double-posting an ineligible payment", () => {
    for (const plan of [
      receiptReceived({date,amountCents:cents,method:"STRIPE"}),
      receiptReceived({date,amountCents:cents,method:"MANUAL"}),
      paymentApplied({date,amountCents:cents,receiptId:"receipt",moneyArrived:true}),
      depositFunded({date,amountCents:cents,sourceReceiptId:"receipt"}),
      creditIssued({date,amountCents:cents,source:"RECEIPT_OVERPAYMENT"}),
      creditIssued({date,amountCents:cents,source:"GOODWILL"}),
      creditIssued({date,amountCents:cents,source:"REFUND_TO_CREDIT"}),
      creditApplied({date,amountCents:cents}),
    ]) check(plan);
    expect(paymentApplied({date,amountCents:cents,receiptId:"receipt",moneyArrived:false})).toBeNull();
    expect(depositFunded({date,amountCents:cents,sourceReceiptId:null})).toBeNull();
  });
  it("balances tax-aware refunds, held deposits and conservative write-offs", () => {
    for (const plan of [
      refundIssued({date,amountCents:cents,stripeRefundId:"stripe",tax:[{filingAccountId:"co",taxCents:250}]}),
      refundIssued({date,amountCents:cents,tax:[]}),
      depositRefunded({date,amountCents:cents,stripeRefundId:"stripe"}),
      depositRefunded({date,amountCents:cents}),
      depositRetained({date,amountCents:cents}),
      invoiceWrittenOff({date,amountCents:cents,taxRecoveryApproved:true,tax:[{filingAccountId:"co",taxCents:250}]}),
      invoiceWrittenOff({date,amountCents:cents,taxRecoveryApproved:false,tax:[{filingAccountId:"co",taxCents:250}]}),
    ]) check(plan);
    expect(() => refundIssued({date,amountCents:100,tax:[{filingAccountId:null,taxCents:200}]})).toThrow();
  });
  it("writing off an unpaid deposit invoice takes back the parked deposit credit instead of booking bad debt", () => {
    const plan = invoiceWrittenOff({date,amountCents:35000,taxRecoveryApproved:false,tax:[],uncollectedDepositCents:25000})!;
    check(plan);
    const sum = (role: string, side: "debit" | "credit") =>
      plan.lines.filter(l => l.role === role).reduce((n, l) => n + (side === "debit" ? l.debitCents : l.creditCents), 0);
    expect(sum("BAD_DEBT","debit")).toBe(10000);
    expect(sum("UNAPPLIED_RECEIPTS","debit")).toBe(25000);
    expect(sum("RECEIVABLES","credit")).toBe(35000);
    expect(() => invoiceWrittenOff({date,amountCents:100,taxRecoveryApproved:false,tax:[],uncollectedDepositCents:200})).toThrow();
  });
  it("books distinct Stripe fees, disputes and payouts and ignores provider money already represented by receipts", () => {
    const cases=[
      {type:"charge",reportingCategory:"charge",amountCents:cents,feeCents:145,expected:["STRIPE_FEE"]},
      {type:"stripe_fee",reportingCategory:"fee",amountCents:-195,feeCents:0,expected:["STRIPE_SERVICE_FEE"]},
      {type:"stripe_fee",reportingCategory:"fee",amountCents:195,feeCents:0,expected:["STRIPE_SERVICE_FEE"]},
      {type:"charge",reportingCategory:"charge",amountCents:-500,feeCents:-95,expected:["STRIPE_FEE"]},
      {type:"adjustment",reportingCategory:"dispute",amountCents:-500,feeCents:0,expected:["STRIPE_DISPUTE"]},
      {type:"adjustment",reportingCategory:"dispute_reversal",amountCents:500,feeCents:0,expected:["STRIPE_DISPUTE"]},
      {type:"payout",reportingCategory:"payout",amountCents:-5000,feeCents:0,expected:["STRIPE_PAYOUT"]},
      {type:"payout_failure",reportingCategory:"payout",amountCents:5000,feeCents:0,expected:["STRIPE_PAYOUT"]},
      {type:"refund",reportingCategory:"refund",amountCents:-500,feeCents:0,expected:[]},
    ];
    for(const row of cases) {
      const plans=stripeBalancePlans({...row,date});
      expect(plans.map(x=>x.eventKind)).toEqual(row.expected);
      plans.forEach(p=>check(p.plan));
    }
  });
  it("balances expenses, contributions, depreciation, use-tax, returns and opening balances", () => {
    const posted=expensePosted({date,amountCents:cents,accountRole:"REPAIRS_PARTS",paidFromRole:"BANK",capitalize:false});
    check(posted);
    check(expensePosted({date,amountCents:cents,accountRole:"REPAIRS_PARTS",paidFromRole:"CARD",capitalize:true}));
    check(expenseVoided(posted!,date));
    check(applianceContributed({date,amountCents:cents,booksStartDate:new Date("2026-11-01Z"),capitalizedExpenseExists:false}));
    expect(applianceContributed({date,amountCents:cents,booksStartDate:date,capitalizedExpenseExists:true})).toBeNull();
    check(depreciationAccrued({date:new Date("2026-10-31T21:00:00Z"),amountCents:250,periodKey:"2026-10"}));
    expect(() => depreciationAccrued({date,amountCents:250,periodKey:"2026-10"})).toThrow(/last Colorado/);
    expect(() => depreciationAccrued({date,amountCents:250,periodKey:"2026-09"})).toThrow();
    check(useTaxAccrued({date,amountCents:250,filingAccountId:"co"}));
    check(taxFiled({date,filingAccountId:"co",salesTaxCents:1200,useTaxCents:500,paidCents:1600,serviceFeeRetainedCents:20}));
    check(openingBalance({date,stripeCents:10000,bankCents:600,cardCents:200}));
    check(openingBalance({date,stripeCents:0,bankCents:0,cardCents:200}));
    expect(postingBusinessDate(new Date("2026-11-01T07:30:00Z")).toISOString()).toBe("2026-11-01T06:00:00.000Z");
  });
  it("preserves inverse entry with no accidental second money effect", () => {
    const original=receiptReceived({date,amountCents:500,method:"STRIPE"})!;
    const reversed=reversePlan(original,date,"Correction");
    check(reversed);
    expect(reversed.lines[0].debitCents).toBe(original.lines[0].creditCents);
    expect(reversed.lines[0].creditCents).toBe(original.lines[0].debitCents);
  });
});
