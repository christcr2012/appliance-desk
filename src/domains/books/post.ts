import { cashEventPlan } from "./cash/event-plan";
import { Prisma, type JournalSourceType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordSystemIssue, resolveSystemIssue } from "@/domains/system-issues";
import { SUCCESSFUL_PAYMENT_STATUSES, isSuccessfulPaymentStatus } from "@/domains/billing/payment-status";
import { businessDateKey, businessDateFromKey } from "@/lib/business-date";
import { accountIdForRole, ensureTaxLiabilityAccounts } from "./accounts";
import {
  type PostingPlan, PostingEvidenceError, invoiceRecognition, invoiceVoided,
  receiptReceived, paymentApplied, creditIssued, creditApplied, refundIssued,
  depositFunded, depositRefunded, depositRetained, expensePosted, expenseVoided,
  useTaxAccrued as planUseTaxAccrual, scrapReceived, stripeBalancePlans, applianceContributed, reversePlan, invoiceAdjustment, invoiceVoidFromPosted, netByAccount, taxFiled, balancedPlan, invoiceWrittenOff,
} from "./posting-rules";

export type BooksProblem = { sourceType: string; sourceId: string; message: string };
export type BooksResult = { posted: number; problems: BooksProblem[] };
type Tx = Prisma.TransactionClient;
type Event = { eventKind: string; plan: PostingPlan };
type Subject = { customerId?: string | null; applianceId?: string | null };
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const cents = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new PostingEvidenceError("Source contains invalid amount cents.");
  return value;
};

/** Find first available month without modifying a closed period. */
export async function journalPlacement(tx: Tx, sourceDate: Date) {
  const originalBusinessDate = businessDateKey(sourceDate);
  let key = originalBusinessDate.slice(0,7);
  for (let months = 0; months < 240; months++) {
    // Serialize the posting/closing decision for the same accounting month.
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${"books-period:"+key}))) AS guard`;
    const period = await tx.accountingPeriod.findUnique({ where: { periodKey: key }, select: { status: true } });
    if (period?.status !== "CLOSED") {
      const newDate = months === 0 ? businessDateFromKey(originalBusinessDate)! :
        businessDateFromKey(key + "-01")!;
      return { entryDate: newDate, periodKey: key, lateForDate: months === 0 ? null : businessDateFromKey(originalBusinessDate)! };
    }
    const [year, month] = key.split("-").map(Number);
    key = new Date(Date.UTC(year, month, 1)).toISOString().slice(0,7);
  }
  throw new PostingEvidenceError("No open accounting month within 20 years.");
}

/** Single transaction holds evidence read, account mapping, closed-month check and journal insert. */
export async function writeJournal(tx: Tx, sourceType: JournalSourceType, sourceId: string,
  eventKind: string, plan: PostingPlan, extra: Subject = {}) {
  // K-CASH: the revision row is the common first lock for ALL ledger writers,
  // before month locks. It also makes this uniqueness check race-safe.
  const revisionLock = await tx.$queryRaw<Array<{ revision: bigint }>>`
    SELECT "revision" FROM "BooksPostingRevision" WHERE "id" = ${"singleton"} FOR UPDATE
  `;
  if (!revisionLock.length) throw new PostingEvidenceError("Books posting revision is not initialized.");
  const exists = await tx.journalEntry.findUnique({
    where: { sourceType_sourceId_eventKind: { sourceType, sourceId, eventKind } }, select: { id: true },
  });
  if (exists) return false;
  const place = await journalPlacement(tx, plan.entryDate);
  const resolved = await Promise.all(plan.lines.map(async line => ({
    ledgerAccountId: await accountIdForRole(tx, line.role), debitCents: line.debitCents, creditCents: line.creditCents,
  })));
  const debit = resolved.reduce((sum, line) => sum + line.debitCents,0);
  const credit = resolved.reduce((sum, line) => sum + line.creditCents,0);
  if (debit !== credit || !Number.isSafeInteger(debit) || !debit || resolved.length < 2)
    throw new PostingEvidenceError("Refusing unbalanced or empty journal.");
  const memo = place.lateForDate ? `Late entry for ${businessDateKey(place.lateForDate)}: ${plan.memo}` : plan.memo;
  await tx.journalEntry.create({
    data: { sourceType, sourceId, eventKind, ...extra, ...place, memo: memo.slice(0, 500), lines: { create: resolved } },
  });
  await tx.booksPostingRevision.update({
    where: { id: "singleton" }, data: { revision: { increment: 1 } },
  });
  return true;
}

function isCreditFromReceipt(sourceType: string | null | undefined) {
  const kind=sourceType?.toUpperCase();
  return kind==="RECEIPT_OVERPAYMENT"||kind==="HELD_PAYMENT";
}

export async function sourceEvents(tx: Tx, sourceType: JournalSourceType, sourceId: string):
Promise<{ events: Event[]; extra: Subject }> {
  switch (sourceType) {
    case "INVOICE": {
      const x = await tx.invoice.findUnique({ where: { id: sourceId },
        include: { lineItems: { select: { kind: true, amountCents: true } },
          taxLines: { select: { taxCents: true, jurisdiction: { select: { filingAccountId: true } } } } } });
      if (!x) return { events: [], extra: {} };
      if (x.status === "DRAFT") return { events: [], extra: {} };
      if (x.stripeInvoiceId && !x.issuedAt)
        throw new PostingEvidenceError("Stripe invoice is missing signed finalized date evidence.");
      const snapshot = {status: x.status === "VOID" ? "VOID" as const : "OPEN" as const,
        createdAt: x.issuedAt ?? x.createdAt, billingPeriodStart: x.billingPeriodStart,
        voidedAt: x.cancelledAt, amountDueCents: x.amountDueCents,
        items: x.lineItems, taxes: x.taxLines.map(t => ({taxCents:t.taxCents,filingAccountId:t.jurisdiction.filingAccountId})) };
      const recognized = invoiceRecognition(snapshot);
      // What the books already say about this invoice: the first entry plus any later changes. A void undoes exactly
      // that (not the invoice as it reads now), and a change after posting is booked as a difference.
      const prior = await tx.journalEntry.findMany({
        where: { sourceType: "INVOICE", sourceId: x.id, OR: [{ eventKind: "INVOICE_RECOGNIZED" }, { eventKind: { startsWith: "INVOICE_ADJUSTED_" } }] },
        select: { eventKind: true, lines: { select: { ledgerAccountId: true, debitCents: true, creditCents: true } } },
      });
      const posted = netByAccount(prior.flatMap(e => e.lines.map(l => ({ accountId: l.ledgerAccountId, debitCents: l.debitCents, creditCents: l.creditCents }))));
      let reversed: PostingPlan | null = null;
      if (x.status === "VOID") {
        if (prior.length) {
          if (!x.cancelledAt) throw new PostingEvidenceError("Voided invoice lacks evidence date.");
          reversed = invoiceVoidFromPosted(x.cancelledAt, posted);
        } else reversed = invoiceVoided(snapshot);
      }
      const events:Event[] = [
        ...(recognized ? [{eventKind:"INVOICE_RECOGNIZED",plan:recognized}] : []),
        ...(reversed ? [{eventKind:"INVOICE_VOIDED",plan:reversed}] : []),
      ];
      if (x.status !== "VOID" && recognized && prior.length) {
        const current = new Map<string, number>();
        for (const line of recognized.lines) {
          const id = await accountIdForRole(tx, line.role);
          current.set(id, (current.get(id) ?? 0) + line.debitCents - line.creditCents);
        }
        const change = invoiceAdjustment(x.updatedAt, current, posted);
        if (change) events.push({ eventKind: "INVOICE_ADJUSTED_" + (prior.filter(e => e.eventKind !== "INVOICE_RECOGNIZED").length + 1), plan: change });
      }
      if(x.writtenOffAt) {
        // Credited invoice allocations are already included in amountPaidCents.
        const open=cents(x.amountDueCents-x.amountPaidCents);
        const policy=await tx.businessSettings.findUnique({where:{id:"singleton"},select:{badDebtTaxRecovery:true}});
        if(policy?.badDebtTaxRecovery==="UNDECIDED")throw new PostingEvidenceError("Bad debt tax recovery policy awaits owner/CPA approval.");
        if(policy?.badDebtTaxRecovery==="YES"&&x.taxLines.some(t=>t.taxCents>0))
          throw new PostingEvidenceError("Bad debt tax recovery must be apportioned to open tax lines before posting.");
        // A deposit that was never collected is parked as a credit when the invoice posts;
        // writing the invoice off must take that parked credit back, not call it bad debt.
        const depositBilled=x.lineItems.filter(i=>i.kind==="DEPOSIT").reduce((n,i)=>n+i.amountCents,0);
        let depositFunded=0;
        if(depositBilled>0){
          const receiptIds=(await tx.payment.findMany({where:{invoiceId:x.id,receiptId:{not:null}},select:{receiptId:true}})).map(p=>p.receiptId as string);
          if(receiptIds.length)depositFunded=(await tx.deposit.findMany({where:{sourceReceiptId:{in:receiptIds}},select:{amountCents:true}})).reduce((n,d)=>n+d.amountCents,0);
        }
        const uncollectedDeposit=Math.max(0,Math.min(open,depositBilled-depositFunded));
        const written=invoiceWrittenOff({date:x.writtenOffAt,amountCents:open,taxRecoveryApproved:false,tax:[],uncollectedDepositCents:uncollectedDeposit});
        if(written)events.push({eventKind:"INVOICE_WRITTEN_OFF",plan:written});
      }      else {
        // The owner took the write-off back (a held payment turned out to be owed). The original write-off entry is
        // never edited; a reversing entry puts the receivable back, so the books match the invoice again.
        const original=await tx.journalEntry.findFirst({where:{sourceType:"INVOICE",sourceId:x.id,eventKind:"INVOICE_WRITTEN_OFF"},
          include:{lines:{include:{ledgerAccount:{select:{systemRole:true}}}}}});
        if(original){
          const plan=reversePlan({entryDate:original.entryDate,memo:"Uncollectible invoice balance",lines:original.lines.map(l=>({
            role:l.ledgerAccount.systemRole??"ID:"+l.ledgerAccountId,debitCents:l.debitCents,creditCents:l.creditCents}))},
            x.updatedAt,"Write-off taken back");
          events.push({eventKind:"INVOICE_WRITE_OFF_REVERSED",plan});
        }
      }
      return { events, extra: {customerId: x.customerId} };
    }
    case "RECEIPT": {
      const x = await tx.receipt.findUnique({ where: { id:sourceId } });
      return { events: x ? [{eventKind:"RECEIPT_RECEIVED",
        plan:receiptReceived({ date:x.receivedOn,amountCents:cents(x.amountCents),method:x.source })!}] : [],
        extra: {customerId:x?.customerId} };
    }
    case "PAYMENT": {
      const x = await tx.payment.findUnique({ where: { id:sourceId },include:{invoice:{select:{customerId:true}}} });
      if (!x) return { events:[], extra:{} };
      const settled = isSuccessfulPaymentStatus(x.status);
      if (!settled) return {events:[],extra:{customerId:x.invoice.customerId}};
      const plan=paymentApplied({date:x.createdAt,amountCents:cents(x.amountCents),receiptId:x.receiptId,moneyArrived:true});
      return {events:plan?[{eventKind:"PAYMENT_APPLIED",plan}]:[],extra:{customerId:x.invoice.customerId}};
    }
    case "DEPOSIT": {
      const x=await tx.deposit.findUnique({where:{id:sourceId},include:{agreement:{select:{customerId:true}},sourceReceipt:{select:{receivedOn:true}}}});
      if (!x) return {events:[],extra:{}};
      const events:Event[]=[];
      if(x.amountCents>0&&!x.sourceReceiptId)throw new PostingEvidenceError("Deposit has no immutable source receipt.");
      const funded=depositFunded({date:x.sourceReceipt?.receivedOn ?? new Date(0),amountCents:cents(x.amountCents),sourceReceiptId:x.sourceReceiptId});
      if(funded)events.push({eventKind:"DEPOSIT_FUNDED",plan:funded});
      if(x.refundedAt) {
        const refunded = cents(x.refundedAmountCents??0);
        if(refunded > x.amountCents)throw new PostingEvidenceError("Deposit refund exceeds funding.");
        const returned=depositRefunded({date:x.refundedAt,amountCents:refunded,stripeRefundId:x.stripeRefundId});
        if(returned)events.push({eventKind:"DEPOSIT_REFUNDED",plan:returned});
        const kept=depositRetained({date:x.refundedAt,amountCents:x.amountCents-refunded});
        if(kept)events.push({eventKind:"DEPOSIT_RETAINED",plan:kept});
      }
      return {events,extra:{customerId:x.agreement.customerId}};
    }
    case "CUSTOMER_CREDIT": {
      const x=await tx.customerCredit.findUnique({where:{id:sourceId}});
      if(!x)return {events:[],extra:{}};
      // Credits made from money that already arrived (an overpayment, or a late
      // payment kept as credit) move it out of "unapplied receipts"; they are not
      // an expense. Only a refund-to-credit hits the refunds account.
      // A held-payment credit posted before this correction already has a goodwill entry; keep it as it is
      // (it is a different event kind, so posting again would double the liability).
      const legacyHeld=x.sourceType?.toUpperCase()==="HELD_PAYMENT"&&
        (await tx.journalEntry.count({where:{sourceType:"CUSTOMER_CREDIT",sourceId,eventKind:"CREDIT_GRANTED"}}))>0;
      const type=legacyHeld ? "GOODWILL" : isCreditFromReceipt(x.sourceType) ? "RECEIPT_OVERPAYMENT" :
        x.sourceType?.toUpperCase()==="REFUND_TO_CREDIT"||x.reason.toUpperCase().includes("REFUND") ? "REFUND_TO_CREDIT" : "GOODWILL";
      const plan=creditIssued({date:x.createdAt,amountCents:cents(x.amountCents),source:type});
      return {events:plan?[{eventKind:type==="RECEIPT_OVERPAYMENT"?"CREDIT_FROM_RECEIPT":"CREDIT_GRANTED",plan}]:[],extra:{customerId:x.customerId}};
    }
    case "CREDIT_APPLICATION": {
      const x=await tx.creditApplication.findUnique({where:{id:sourceId},include:{credit:{select:{customerId:true}}}});
      const plan=x&&creditApplied({date:x.createdAt,amountCents:cents(x.amountCents)});
      return {events:plan?[{eventKind:"CREDIT_APPLIED",plan}]:[],extra:{customerId:x?.credit.customerId}};
    }
    case "REFUND": {
      const x=await tx.refund.findUnique({where:{id:sourceId},include:{invoice:{select:{customerId:true}}}});
      if(!x)return {events:[],extra:{}};
      // There is no per-refund tax attribution stored yet. Never invent tax-recovery allocation.
      // A refund against a taxed bill is held for K-2 exception and owner/CPA evidence.
      // A refund kept as store credit sends no money out: the credit's own entry
      // (refunds expense / customer credits liability) is the whole story.
      const toCredit=await tx.customerCredit.count({where:{sourceType:"REFUND_TO_CREDIT",sourceId:x.id}});
      if(toCredit>0)return {events:[],extra:{customerId:x.invoice.customerId}};
      // A card refund that Stripe has not confirmed (still pending, failed, or unknown) sent no money out yet.
      // The refund row is written first, so wait for Stripe's confirmation id before the books say it was paid.
      if(!x.stripeRefundId&&await tx.providerOperation.count({where:{kind:"REFUND_CREATE",subjectType:"Refund",subjectId:x.id}})>0)
        return {events:[],extra:{customerId:x.invoice.customerId}};
      const tax=await tx.invoiceTaxLine.count({where:{invoiceId:x.invoiceId,taxCents:{gt:0}}});
      if(tax)throw new PostingEvidenceError("Taxed refund lacks an immutable refund tax allocation.");
      const plan=refundIssued({date:x.createdAt,amountCents:cents(x.amountCents),stripeRefundId:x.stripeRefundId,tax:[]});
      return {events:plan?[{eventKind:"REFUND_ISSUED",plan}]:[],extra:{customerId:x.invoice.customerId}};
    }
    case "EXPENSE": {
      const x=await tx.expense.findUnique({where:{id:sourceId},include:{category:{include:{}}}});
      if(!x||x.status==="DRAFT"||x.status==="SUBMITTED")return {events:[],extra:{}};
      if(!x.postedAt)throw new PostingEvidenceError("Expense lacks approved posting evidence.");
      const account=await tx.ledgerAccount.findUnique({where:{id:x.category.ledgerAccountId},select:{systemRole:true}});
      const paid=await tx.ledgerAccount.findUnique({where:{id:x.paidFromAccountId},select:{systemRole:true}});
      if(!account||!paid)throw new PostingEvidenceError("Expense has a missing ledger account.");
      const posted=expensePosted({date:x.spentOn,amountCents:cents(x.amountCents),
        accountRole:account.systemRole??"ID:"+x.category.ledgerAccountId,
        paidFromRole:paid.systemRole??"ID:"+x.paidFromAccountId,
        capitalize:x.capitalizeToAppliance});
      if(!posted)return {events:[],extra:{applianceId:x.applianceId}};
      const events:Event[]=[{eventKind:"EXPENSE_POSTED",plan:posted}];
      if(x.status==="VOID"&&x.voidedAt)events.push({eventKind:"EXPENSE_VOIDED",plan:expenseVoided(posted,x.voidedAt)});
      return {events,extra:{applianceId:x.applianceId}};
    }
    case "SCRAP_PAYMENT": {
      const x=await tx.scrapPayment.findUnique({where:{id:sourceId}});
      if(!x)return {events:[],extra:{}};
      const deposit=await tx.ledgerAccount.findUnique({where:{id:x.depositAccountId},select:{systemRole:true}});
      if(!deposit)throw new PostingEvidenceError("Scrap payment has a missing deposit account.");
      const received=scrapReceived({date:x.receivedOn,amountCents:cents(x.amountCents),
        depositRole:deposit.systemRole??"ID:"+x.depositAccountId});
      if(!received)return {events:[],extra:{}};
      const events:Event[]=[{eventKind:"SCRAP_RECEIVED",plan:received}];
      if(x.voidedAt)events.push({eventKind:"SCRAP_VOIDED",plan:reversePlan(received,x.voidedAt,"Scrap money entry voided")});
      return {events,extra:{}};
    }
    case "USE_TAX": {
      const x=await tx.purchaseUseTax.findUnique({where:{id:sourceId},include:{jurisdiction:{select:{useTaxFilingAccountId:true}}}});
      if(!x||x.useTaxDueCents<=0)return {events:[],extra:{}};
      if(!x.jurisdiction.useTaxFilingAccountId)throw new PostingEvidenceError("Use tax has no filing account.");
      const plan=planUseTaxAccrual({date:x.purchasedOn,amountCents:cents(x.useTaxDueCents),filingAccountId:x.jurisdiction.useTaxFilingAccountId});
      return {events:plan?[{eventKind:"USE_TAX_ACCRUED",plan}]:[],extra:{}};
    }
    case "STRIPE_BALANCE_TXN": {
      const x=await tx.stripeBalanceTransaction.findUnique({where:{id:sourceId}});
      if(!x)return {events:[],extra:{}};
      if(x.currency.toLowerCase()!=="usd" || !Number.isSafeInteger(x.amountCents) ||
        !Number.isSafeInteger(x.feeCents) || x.amountCents-x.feeCents!==x.netCents)
        throw new PostingEvidenceError("Stripe financial evidence has inconsistent currency or amount.");
      if(x.type==="adjustment"&&!["dispute","dispute_reversal"].includes(x.reportingCategory)&&x.amountCents!==0)
        throw new PostingEvidenceError("Unclassified Stripe adjustment needs owner review before booking.");
      const events=stripeBalancePlans({type:x.type,reportingCategory:x.reportingCategory,
        date:x.createdAtStripe,amountCents:x.amountCents,feeCents:x.feeCents});
      const ordinary=new Set(["charge","payment","refund","payment_refund","transfer"]);
      if(!events.length&&!ordinary.has(x.type)&&
        (x.amountCents!==0||x.feeCents!==0))
        throw new PostingEvidenceError("Unknown Stripe balance transaction type; review before booking.");
      return {events,extra:{}};
    }
    case "APPLIANCE": {
      const x=await tx.appliance.findUnique({where:{id:sourceId}});
      if(!x||!x.acquisitionCostCents)return {events:[],extra:{}};
      const settings=await tx.businessSettings.findUnique({where:{id:"singleton"},select:{booksStartDate:true}});
      if(!settings?.booksStartDate)return {events:[],extra:{}};
      const alreadyCapitalized=await tx.expense.count({where:{applianceId:x.id,capitalizeToAppliance:true,status:"POSTED"}});
      const plan=applianceContributed({date:x.purchaseDate??x.createdAt,amountCents:cents(x.acquisitionCostCents),
        booksStartDate:settings.booksStartDate,capitalizedExpenseExists:alreadyCapitalized>0});
      return {events:plan?[{eventKind:"APPLIANCE_CONTRIBUTED",plan}]:[],extra:{applianceId:x.id}};
    }
    case "CASH_EVENT": {
      const event=await tx.bookCashEvent.findUnique({where:{id:sourceId}});
      if(!event)return {events:[],extra:{}};
      const plan=cashEventPlan(event);
      return {events:[{eventKind:event.reversalOfId?"CASH_EVENT_REVERSED":"CASH_EVENT_POSTED",plan}],extra:{}};
    }
    case "TAX_FILING": {
      const x=await tx.taxFilingPeriod.findUnique({where:{id:sourceId}});
      if(!x||x.status!=="FILED")return {events:[],extra:{}};
      if(!x.filedOn||!Number.isSafeInteger(x.amountPaidCents)||!x.worksheet)
        throw new PostingEvidenceError("Filed return lacks immutable payment and worksheet evidence.");
      const sheet=x.worksheet;
      if(typeof sheet!=="object"||Array.isArray(sheet)||!("totals" in sheet)||!("account" in sheet))
        throw new PostingEvidenceError("Filed worksheet has an unknown structure; no booking.");
      const totals=sheet.totals,account=sheet.account;
      if(!totals||typeof totals!=="object"||Array.isArray(totals)||
        !account||typeof account!=="object"||Array.isArray(account)||
        account.id!==x.filingAccountId||typeof account.kind!=="string")
        throw new PostingEvidenceError("Filing account/worksheet mismatch.");
      const numbers=totals as Record<string,unknown>;
      if(!Number.isSafeInteger(numbers.taxCents)||!Number.isSafeInteger(x.amountPaidCents))
        throw new PostingEvidenceError("Filing worksheet tax cents missing.");
      const kind=account.kind;
      const fee=cents(x.serviceFeeRetainedCents??0);
      let plan:PostingPlan|null=null;
      if(kind==="RETAIL_DELIVERY_FEE_RETURN") {
        const rdf=cents(numbers.taxCents as number);
        const diff=rdf-x.amountPaidCents!-fee;
        plan=balancedPlan(x.filedOn,"Colorado retail delivery fees filed",[
          {role:"RETAIL_DELIVERY_FEE_PAYABLE",debitCents:rdf,creditCents:0},
          {role:"BANK",debitCents:0,creditCents:cents(x.amountPaidCents!)},
          {role:"TAX_SERVICE_FEE_INCOME",debitCents:0,creditCents:fee},
          ...(diff>0?[{role:"TAX_ADJUSTMENTS",debitCents:0,creditCents:diff}]:
            diff<0?[{role:"TAX_ADJUSTMENTS",debitCents:-diff,creditCents:0}]:[]),
        ]);
      } else {
        const tax=cents(numbers.taxCents as number);
        if(kind!=="SALES_RETURN"&&kind!=="USE_TAX_RETURN")
          throw new PostingEvidenceError("Unknown filing-account type.");
        // Use tax is included in the frozen sales return total; do not book it twice as sales tax.
        const useRows=Array.isArray(sheet.useTax)?sheet.useTax:[];
        const useTotal=useRows.reduce<number>((sum,row)=>{
          if(!row||typeof row!=="object"||Array.isArray(row)||
            !("useTaxCents" in row)||!Number.isSafeInteger(row.useTaxCents))
            throw new PostingEvidenceError("Filed use tax row has invalid cents.");
          return sum+(row.useTaxCents as number);
        },0);
        if(useTotal>tax||useTotal<0)throw new PostingEvidenceError("Frozen use tax exceeds the total.");
        const use=kind==="USE_TAX_RETURN"?tax:useTotal;
        const sales=kind==="SALES_RETURN"?tax-use:0;
        plan=taxFiled({date:x.filedOn,filingAccountId:x.filingAccountId,salesTaxCents:sales,
          useTaxCents:use,paidCents:cents(x.amountPaidCents!),serviceFeeRetainedCents:fee});
      }
      return {events:plan?[{eventKind:"TAX_FILED",plan}]:[],extra:{}};
    }
    case "OPENING": {
      const settings=await tx.businessSettings.findFirst({select:{booksStartDate:true}});
      if(!settings?.booksStartDate||businessDateKey(settings.booksStartDate)!==sourceId)return {events:[],extra:{}};
      const already=await tx.journalEntry.findUnique({
        where:{sourceType_sourceId_eventKind:{sourceType:"OPENING",sourceId,eventKind:"OPENING_BALANCE"}},include:{lines:true}});
      if(already)return {events:[],extra:{}};
      // Opening source must be owner-attested and stored; no inferred bank/provider balance.
      throw new PostingEvidenceError("Opening balances not approved; use owner Books setup.");
    }
    default: throw new PostingEvidenceError("Source type not yet supported: "+sourceType);
  }
}
export async function postForSource(tx: Tx, sourceType: JournalSourceType, sourceId: string): Promise<void> {
  const settings = await tx.businessSettings.findFirst({select:{booksStartDate:true}});
  if(!settings?.booksStartDate)return;
  await ensureTaxLiabilityAccounts(tx);
  const {events,extra}=await sourceEvents(tx,sourceType,sourceId);
  for(const {eventKind,plan} of events) {
    if(plan.entryDate<settings.booksStartDate)continue;
    await writeJournal(tx,sourceType,sourceId,eventKind,plan,extra);
  }
}
function stripeExpectedEvents(x:{type:string;reportingCategory:string;feeCents:number}):string[] {
  const feeType=["stripe_fee","tax_fee","application_fee"].includes(x.type);
  const kinds:string[]=[];
  if(x.feeCents&&!feeType)kinds.push("STRIPE_FEE");
  if(feeType)kinds.push("STRIPE_SERVICE_FEE");
  if(x.type==="adjustment"&&["dispute","dispute_reversal"].includes(x.reportingCategory))kinds.push("STRIPE_DISPUTE");
  if(x.type==="payout"||x.type==="payout_failure")kinds.push("STRIPE_PAYOUT");
  if(!kinds.length&&!["charge","payment","refund","payment_refund","transfer"].includes(x.type))kinds.push("STRIPE_UNMAPPED");
  return kinds;
}
export function selectFairBooksCandidates<T extends {type:string;id:string;at:Date}>(
  input: readonly T[], limit: number,
): T[] {
  const ordered=[...input].sort((a,b)=>a.at.getTime()-b.at.getTime()||a.id.localeCompare(b.id));
  if(limit<=0)return [];
  const types=[...new Set(ordered.map(x=>x.type))];
  // Reserve a single newest item per type only when capacity is ample;
  // do not displace the oldest financial evidence in tiny focused batches.
  if(limit < types.length*2)return ordered.slice(0,limit);
  // Give each category enough current source slots to avoid a large historical
  // backlog hiding an invoice adjustment or today's multiple real payments.
  // At least half the batch remains available for oldest-first catch-up.
  const fresh=new Set<string>();
  const recentPerType=Math.max(1,Math.floor(limit/(Math.max(1,types.length)*2)));
  for(const type of types){
    const newest=ordered.filter(x=>x.type===type).slice(-recentPerType);
    for(const x of newest)fresh.add(type+"\0"+x.id);
  }
  const picked=ordered.filter(x=>fresh.has(x.type+"\0"+x.id));
  for(const x of ordered){
    if(picked.length>=limit)break;
    if(!fresh.has(x.type+"\0"+x.id))picked.push(x);
  }
  return picked.sort((a,b)=>a.at.getTime()-b.at.getTime()||a.id.localeCompare(b.id));
}

/** A later void/refund/write-off is due in its own month, not in the source's first month. */
/** Align the funding liability with the original receipt, not deposit creation. */
export function depositBookEventDates(source:{
 createdAt:Date; sourceReceipt: {receivedOn:Date}|null; refundedAt:Date|null;
}):Record<string,Date|null>{
 return {DEPOSIT_FUNDED:source.sourceReceipt?.receivedOn??source.createdAt,
  DEPOSIT_REFUNDED:source.refundedAt,DEPOSIT_RETAINED:source.refundedAt};
}
export function missingBookEventsInMonth(row:{
 at:Date;required:string[];eventDates?:Record<string,Date|null|undefined>;
},already:ReadonlySet<string>,month:string):string[]{
 return row.required.filter(kind=>!already.has(kind)&&
  businessDateKey(row.eventDates?.[kind]??row.at).slice(0,7)===month);
}
/** `inspectMonth` is a strictly read-only snapshot for the owner's review page. */
export async function postPending(opts?:{limit?:number;inspectMonth?:string;tx?:Tx}):Promise<BooksResult> {
  const db=opts?.tx??prisma;
  if(opts?.inspectMonth&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(opts.inspectMonth))
   throw new Error("Choose a real accounting month.");
  const settings=await db.businessSettings.findFirst({select:{booksStartDate:true}});
  if(!settings?.booksStartDate)return {posted:0,problems:[]};
  const limit=Math.max(1,Math.min(500,opts?.limit??500));
  const since=settings.booksStartDate;
  type Candidate = {type: JournalSourceType; id: string; at: Date; required: string[];
    eventDates?:Record<string,Date|null|undefined>};
  const querySources: { type: JournalSourceType; load: (skip:number,take:number)=>Promise<Candidate[]> }[] = [
    {type:"CASH_EVENT",load:async(skip,take)=>(await db.bookCashEvent.findMany({
      where:{occurredOn:{gte:since}},orderBy:[{occurredOn:"asc"},{id:"asc"}],skip,take,
      select:{id:true,occurredOn:true,reversalOfId:true},
    })).map(x=>({type:"CASH_EVENT",id:x.id,at:x.occurredOn,
      required:[x.reversalOfId?"CASH_EVENT_REVERSED":"CASH_EVENT_POSTED"]}))},

    {type:"INVOICE",load:async(skip,take)=>{
      const invoices=await db.invoice.findMany({
      where:{status:{not:"DRAFT"},OR:[
        {createdAt:{gte:since}},{issuedAt:{gte:since}},
        {billingPeriodStart:{gte:since}},{cancelledAt:{gte:since}},
        {writtenOffAt:{gte:since}},
      ]},select:{id:true,createdAt:true,issuedAt:true,billingPeriodStart:true,cancelledAt:true,status:true,writtenOffAt:true,updatedAt:true,amountDueCents:true},
      orderBy:[{createdAt:"asc"},{id:"asc"}],skip,take});
      // Invoices whose amount due no longer matches what the books recorded (a late fee, waiver or new tax added after
      // posting) need a difference entry. The next entry's name is used as the "still to do" marker.
      const live=invoices.filter(i=>i.status!=="VOID");
      const bookedRows=live.length?await db.journalLine.findMany({
        where:{entry:{sourceType:"INVOICE",sourceId:{in:live.map(i=>i.id)},
          OR:[{eventKind:"INVOICE_RECOGNIZED"},{eventKind:{startsWith:"INVOICE_ADJUSTED_"}}]},
          ledgerAccount:{systemRole:"RECEIVABLES"}},
        select:{debitCents:true,creditCents:true,entry:{select:{sourceId:true,eventKind:true}}}}):[];
      const bookedReceivable=new Map<string,number>(), adjustments=new Map<string,number>();
      for(const row of bookedRows)
        bookedReceivable.set(row.entry.sourceId,(bookedReceivable.get(row.entry.sourceId)??0)+row.debitCents-row.creditCents);
      if(live.length)for(const e of await db.journalEntry.findMany({
        where:{sourceType:"INVOICE",sourceId:{in:live.map(i=>i.id)},eventKind:{startsWith:"INVOICE_ADJUSTED_"}},select:{sourceId:true}}))
        adjustments.set(e.sourceId,(adjustments.get(e.sourceId)??0)+1);
      const needsAdjustment=(i:{id:string;amountDueCents:number})=>bookedReceivable.has(i.id)&&bookedReceivable.get(i.id)!==i.amountDueCents;
      const writtenOffBooks=new Set((await db.journalEntry.findMany({
        where:{sourceType:"INVOICE",eventKind:"INVOICE_WRITTEN_OFF",sourceId:{in:invoices.filter(i=>!i.writtenOffAt).map(i=>i.id)}},
        select:{sourceId:true}})).map(e=>e.sourceId));
      return invoices.map(x=>({type:"INVOICE" as const,id:x.id,
      at:x.billingPeriodStart??x.issuedAt??x.createdAt,
      eventDates:{"INVOICE_VOIDED":x.cancelledAt??x.updatedAt,
       "INVOICE_WRITTEN_OFF":x.writtenOffAt??x.updatedAt,
       "INVOICE_WRITE_OFF_REVERSED":x.updatedAt,
       ["INVOICE_ADJUSTED_"+((adjustments.get(x.id)??0)+1)]:x.updatedAt},
      required:["INVOICE_RECOGNIZED",...(x.status==="VOID"?["INVOICE_VOIDED"]:[]),
        ...(x.writtenOffAt?["INVOICE_WRITTEN_OFF"]:[]),
        ...(!x.writtenOffAt&&writtenOffBooks.has(x.id)?["INVOICE_WRITE_OFF_REVERSED"]:[]),
        ...(needsAdjustment(x)?["INVOICE_ADJUSTED_"+((adjustments.get(x.id)??0)+1)]:[])]}));}},
    {type:"RECEIPT",load:async(skip,take)=>(await db.receipt.findMany({
      where:{receivedOn:{gte:since}},select:{id:true,receivedOn:true},
      orderBy:[{receivedOn:"asc"},{id:"asc"}],skip,take})).map(x=>({type:"RECEIPT",id:x.id,at:x.receivedOn,required:["RECEIPT_RECEIVED"]}))},
    {type:"PAYMENT",load:async(skip,take)=>(await db.payment.findMany({
      where:{createdAt:{gte:since},status:{in:[...SUCCESSFUL_PAYMENT_STATUSES]}},
      select:{id:true,createdAt:true},orderBy:[{createdAt:"asc"},{id:"asc"}],skip,take}))
      .map(x=>({type:"PAYMENT",id:x.id,at:x.createdAt,required:["PAYMENT_APPLIED"]}))},
    {type:"DEPOSIT",load:async(skip,take)=>(await db.deposit.findMany({
      where:{createdAt:{gte:since}},select:{id:true,createdAt:true,sourceReceiptId:true,
        sourceReceipt:{select:{receivedOn:true}},
        amountCents:true,refundedAt:true,refundedAmountCents:true},
      orderBy:[{createdAt:"asc"},{id:"asc"}],skip,take})).map(x=>({type:"DEPOSIT",id:x.id,at:x.createdAt,
      eventDates:depositBookEventDates(x),
      required:[...(x.sourceReceiptId?["DEPOSIT_FUNDED"]:["DEPOSIT_FUNDED"]),
        ...(x.refundedAt&&((x.refundedAmountCents??0)>0)?["DEPOSIT_REFUNDED"]:[]),
        ...(x.refundedAt&&(x.amountCents-(x.refundedAmountCents??0))>0?["DEPOSIT_RETAINED"]:[])]}))},
    {type:"CUSTOMER_CREDIT",load:async(skip,take)=>{
      const rows=await db.customerCredit.findMany({
        where:{createdAt:{gte:since}},select:{id:true,createdAt:true,sourceType:true},
        orderBy:[{createdAt:"asc"},{id:"asc"}],skip,take});
      // Held-payment credits posted before the correction keep their original goodwill entry.
      const legacyHeld=new Set((await db.journalEntry.findMany({
        where:{sourceType:"CUSTOMER_CREDIT",eventKind:"CREDIT_GRANTED",
          sourceId:{in:rows.filter(r=>r.sourceType?.toUpperCase()==="HELD_PAYMENT").map(r=>r.id)}},
        select:{sourceId:true}})).map(e=>e.sourceId));
      return rows.map(x=>({type:"CUSTOMER_CREDIT",id:x.id,at:x.createdAt,
        required:[isCreditFromReceipt(x.sourceType)&&!legacyHeld.has(x.id)?"CREDIT_FROM_RECEIPT":"CREDIT_GRANTED"]}));}},
    {type:"CREDIT_APPLICATION",load:async(skip,take)=>(await db.creditApplication.findMany({
      where:{createdAt:{gte:since}},select:{id:true,createdAt:true},orderBy:[{createdAt:"asc"},{id:"asc"}],skip,take}))
      .map(x=>({type:"CREDIT_APPLICATION",id:x.id,at:x.createdAt,required:["CREDIT_APPLIED"]}))},
    {type:"REFUND",load:async(skip,take)=>{
      const rows=await db.refund.findMany({
        where:{createdAt:{gte:since}},select:{id:true,createdAt:true,stripeRefundId:true},orderBy:[{createdAt:"asc"},{id:"asc"}],skip,take});
      const awaitingStripe=new Set((await db.providerOperation.findMany({
        where:{kind:"REFUND_CREATE",subjectType:"Refund",subjectId:{in:rows.filter(r=>!r.stripeRefundId).map(r=>r.id)}},select:{subjectId:true}})).map(o=>o.subjectId));
      const creditBackedRefunds=new Set((await db.customerCredit.findMany({
        where:{sourceType:"REFUND_TO_CREDIT",sourceId:{in:rows.map(r=>r.id)}},select:{sourceId:true}})).map(c=>c.sourceId));
      return rows.map(x=>({type:"REFUND",id:x.id,at:x.createdAt,required:creditBackedRefunds.has(x.id)||awaitingStripe.has(x.id)?[]:["REFUND_ISSUED"]}));}},
    {type:"EXPENSE",load:async(skip,take)=>(await db.expense.findMany({
      where:{spentOn:{gte:since},status:{in:["POSTED","VOID"]}},select:{id:true,spentOn:true,status:true,voidedAt:true},
      orderBy:[{spentOn:"asc"},{id:"asc"}],skip,take})).map(x=>({type:"EXPENSE",id:x.id,at:x.spentOn,
      eventDates:{"EXPENSE_VOIDED":x.voidedAt},
      required:x.status==="VOID"?["EXPENSE_POSTED","EXPENSE_VOIDED"]:["EXPENSE_POSTED"]}))},
    {type:"SCRAP_PAYMENT",load:async(skip,take)=>(await db.scrapPayment.findMany({
      where:{receivedOn:{gte:since}},select:{id:true,receivedOn:true,voidedAt:true},
      orderBy:[{receivedOn:"asc"},{id:"asc"}],skip,take})).map(x=>({type:"SCRAP_PAYMENT",id:x.id,at:x.receivedOn,
      eventDates:{"SCRAP_VOIDED":x.voidedAt},
      required:x.voidedAt?["SCRAP_RECEIVED","SCRAP_VOIDED"]:["SCRAP_RECEIVED"]}))},
    {type:"USE_TAX",load:async(skip,take)=>(await db.purchaseUseTax.findMany({
      where:{purchasedOn:{gte:since},useTaxDueCents:{gt:0}},select:{id:true,purchasedOn:true},
      orderBy:[{purchasedOn:"asc"},{id:"asc"}],skip,take})).map(x=>({type:"USE_TAX",id:x.id,at:x.purchasedOn,required:["USE_TAX_ACCRUED"]}))},
    {type:"APPLIANCE",load:async(skip,take)=>{
      const appliances=await db.appliance.findMany({
        where:{acquisitionCostCents:{gt:0}},
        select:{id:true,createdAt:true,purchaseDate:true},
        orderBy:[{createdAt:"asc"},{id:"asc"}],skip,take,
      });
      if(!appliances.length)return [];
      // sourceEvents deliberately avoids a second acquisition when the purchase
      // was already posted as a capitalized expense. Match that same rule here,
      // otherwise a perfectly booked machine blocks monthly closing forever.
      const capitalized=await db.expense.findMany({where:{
        applianceId:{in:appliances.map(a=>a.id)},capitalizeToAppliance:true,status:"POSTED",
      },select:{applianceId:true}});
      const capitalizedIds=new Set(capitalized.map(e=>e.applianceId));
      return appliances.map(x=>({type:"APPLIANCE" as const,id:x.id,
        at:x.purchaseDate??x.createdAt,
        required:capitalizedIds.has(x.id)?[]:["APPLIANCE_CONTRIBUTED"]}));
    }},
    {type:"TAX_FILING",load:async(skip,take)=>(await db.taxFilingPeriod.findMany({
      where:{status:"FILED",filedOn:{gte:since}},select:{id:true,filedOn:true},
      orderBy:[{filedOn:"asc"},{id:"asc"}],skip,take})).map(x=>({type:"TAX_FILING",id:x.id,
      at:x.filedOn!,required:["TAX_FILED"]}))},
    {type:"STRIPE_BALANCE_TXN",load:async(skip,take)=>(await db.stripeBalanceTransaction.findMany({
      where:{createdAtStripe:{gte:since}},select:{id:true,createdAtStripe:true,type:true,reportingCategory:true,amountCents:true,feeCents:true},
      orderBy:[{createdAtStripe:"asc"},{id:"asc"}],skip,take})).map(x=>({type:"STRIPE_BALANCE_TXN",id:x.id,at:x.createdAtStripe,
      required:stripeExpectedEvents(x)}))},
  ];
  const sources:Candidate[]=[];
  const problems:BooksProblem[]=[];
  // A successfully posted source can still carry a durable unresolved issue.
  // During month inspection, match that issue to the original source date
  // instead of silently reporting a complete month or flagging other months.
  const unresolved = opts?.inspectMonth ? await db.booksProblem.findMany({
    where:{kind:"SOURCE_NOT_RECORDED",resolvedAt:null},
    select:{subjectType:true,subjectId:true},take:1001,
  }) : [];
  if(unresolved.length>1000)throw new Error("Too many unresolved Books source issues for one review.");
  const unresolvedKeys=new Set(unresolved.map(x=>x.subjectType+"\\0"+x.subjectId));
  // Bounded anti-join: keep oldest unfinished records for catch-up and
  // independently check the invoice tail so new bills aren't hidden
  // behind hundreds of older pending invoices. Every source is deduped.
  const queuedIds=new Set<string>();
  for(const source of querySources) {
    let scanned=0,queuedForSource=0;
    const collect=async(page:Candidate[])=>{
      if(!page.length)return;
      const existing=await db.journalEntry.findMany({where:{
        sourceType:source.type,sourceId:{in:page.map(x=>x.id)},
      },select:{sourceId:true,eventKind:true}});
      const byId=new Map<string,Set<string>>();
      for(const row of existing){
        if(!byId.has(row.sourceId))byId.set(row.sourceId,new Set());
        byId.get(row.sourceId)!.add(row.eventKind);
      }
      const unresolvedStripe=source.type==="STRIPE_BALANCE_TXN"
        ?new Set((await db.systemIssue.findMany({where:{
          kind:"BOOKS_POSTING_FAILURE",status:"OPEN",
          fingerprint:{in:page.map(x=>"books-post:STRIPE_BALANCE_TXN:"+x.id)},
        },select:{fingerprint:true}})).map(x=>x.fingerprint))
        :new Set<string>();
      for(const candidate of page){
        const key=candidate.type+"\\0"+candidate.id;
        if(opts?.inspectMonth&&unresolvedKeys.has(key)&&
          businessDateKey(candidate.at).slice(0,7)===opts.inspectMonth){
          problems.push({sourceType:candidate.type,sourceId:candidate.id,
            message:"A previous accounting source problem still needs review."});
          unresolvedKeys.delete(key);
        }
        const prior=byId.get(candidate.id)??new Set<string>();
        const missing=candidate.required.filter(kind=>!prior.has(kind));
        const complete=candidate.required.length>0&&!missing.length;
        if(!opts?.inspectMonth&&complete&&unresolvedStripe.has("books-post:STRIPE_BALANCE_TXN:"+candidate.id))
          await resolveSystemIssue("books-post:STRIPE_BALANCE_TXN:"+candidate.id,"SOURCE_SUCCEEDED");
        if(candidate.required.length&&missing.length&&!queuedIds.has(key)){
          queuedIds.add(key);
          const relevant=opts?.inspectMonth
           ?missingBookEventsInMonth(candidate,prior,opts.inspectMonth):missing;
          if(relevant.length){
            sources.push(opts?.inspectMonth?{...candidate,required:relevant,
              at:candidate.eventDates?.[relevant[0]!]??candidate.at}:candidate);
            queuedForSource++;
          }
        }
      }
    };
    while(scanned<10000&&queuedForSource<limit) {
      const page=await source.load(scanned,Math.min(200,10000-scanned));
      if(!page.length)break;
      scanned+=page.length;
      await collect(page);
      if(page.length<200)break;
    }
    // A second, small window at the newest end is essential for a
    // bounded backlog: fresh invoices and corrections cannot depend
    // on clearing 500 old invoices in previous nightly runs.
    if(source.type==="INVOICE"){
      const invoiceWhere={status:{not:"DRAFT" as const},OR:[
        {createdAt:{gte:since}},{issuedAt:{gte:since}},
        {billingPeriodStart:{gte:since}},{cancelledAt:{gte:since}},
        {writtenOffAt:{gte:since}},
      ]};
      const total=await db.invoice.count({where:invoiceWhere});
      const recent=Math.min(limit,200);
      const skip=Math.max(0,total-recent);
      if(skip>0)await collect(await source.load(skip,recent));
    }
    if(scanned>=10000)problems.push({sourceType:source.type,sourceId:"backlog",
      message:"Accounting backlog scan cap reached; continue the next bounded run."});
  }
  // Reserve a fresh candidate of each source type so a persistent old
  // equipment backlog cannot hide today's invoice/payment from the nightly
  // bounded pass. Fill the rest oldest-first for fair backlog catch-up.
  const selected=selectFairBooksCandidates(sources,limit);
  if(opts?.inspectMonth)return {posted:0,problems:[
   ...problems,...selected.map(row=>({sourceType:row.type,sourceId:row.id,
    message:"This record is not fully posted for the reviewed month."})),
  ]};
  let posted=0;
  for(const x of selected) {
    try {
      const result=await prisma.$transaction(async tx=>{
        const before=await tx.journalEntry.count({where:{sourceType:x.type,sourceId:x.id}});
        await postForSource(tx,x.type,x.id);
        const after=await tx.journalEntry.count({where:{sourceType:x.type,sourceId:x.id}});
        return after-before;
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:15000});
      posted+=result;
      if (x.type === "STRIPE_BALANCE_TXN")
        await resolveSystemIssue("books-post:STRIPE_BALANCE_TXN:" + x.id, "SOURCE_SUCCEEDED");
    } catch(e) {
      if(isUnique(e)||e instanceof Prisma.PrismaClientKnownRequestError&&e.code==="P2034")continue;
      problems.push({sourceType:x.type,sourceId:x.id,message:e instanceof Error?e.message:"Unrecognized books problem"});
      await recordSystemIssue({kind:"BOOKS_POSTING_FAILURE",sourceType:x.type,sourceId:x.id});
    }
  }
  return {posted,problems};
}
