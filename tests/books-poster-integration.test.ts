import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { postForSource, postPending, journalPlacement } from "@/domains/books/post";
import { getBooksWorkspace, initializeBooks, closeAccountingMonth, reopenAccountingMonth,
  exportMonthReview, renameAccount, addCustomAccount, mapExportAccount, BooksPermissionError } from "@/domains/books/management";

const tag=randomUUID().slice(0,12),ownerId="books-owner-"+tag,customerId="books-customer-"+tag;
const invoiceId="books-invoice-"+tag,receiptId="books-receipt-"+tag,paymentId="books-payment-"+tag;
const invalidInvoiceId="books-bad-invoice-"+tag;
const issuedLateInvoiceId="books-issued-late-"+tag;
const writeOffInvoiceId="books-writeoff-"+tag;
const receiptCreditId="books-receipt-credit-"+tag;
const partialCreditId="books-partial-credit-"+tag;
const partialApplicationId="books-credit-appl-"+tag;
const heldCreditId="books-held-credit-"+tag, refundCreditId="books-refund-credit-"+tag, creditRefundId="books-credit-refund-"+tag;
const earlierReceiptId="books-early-receipt-"+tag;
const lateReceiptId="books-late-receipt-"+tag, stripeId="books-stripe-"+tag;
const actor={id:ownerId,role:"OWNER" as const},staff={id:ownerId,role:"STAFF" as const},guest={id:ownerId,role:"CUSTOMER" as const};
const start="2026-01-01";
let savedStart:Date|null=null, extraAccount:string|null=null, savedBadDebtPolicy="UNDECIDED";
const month="2026-10";
beforeAll(async()=>{
  const settings=await prisma.businessSettings.findUnique({where:{id:"singleton"}});
  savedStart=settings?.booksStartDate??null;
  savedBadDebtPolicy=settings?.badDebtTaxRecovery??"UNDECIDED";
  await prisma.user.create({data:{id:ownerId,email:tag+"@example.test",role:"OWNER"}});
  await prisma.customer.create({data:{id:customerId,userId:ownerId,referralCode:"BOOKS-"+tag}});
  await prisma.businessSettings.upsert({where:{id:"singleton"},create:{id:"singleton",booksStartDate:null},update:{booksStartDate:null}});
});
afterAll(async()=>{
  await prisma.exportBatchEntry.deleteMany({where:{batch:{createdByUserId:ownerId}}});
  await prisma.exportBatch.deleteMany({where:{createdByUserId:ownerId}});
  await prisma.journalLine.deleteMany({where:{entry:{sourceId:{in:[invoiceId,receiptId,paymentId,invalidInvoiceId,lateReceiptId,stripeId,issuedLateInvoiceId,writeOffInvoiceId,receiptCreditId,partialCreditId,partialApplicationId,earlierReceiptId,heldCreditId,refundCreditId,creditRefundId,start]}}}});
  await prisma.journalEntry.deleteMany({where:{sourceId:{in:[invoiceId,receiptId,paymentId,invalidInvoiceId,lateReceiptId,stripeId,issuedLateInvoiceId,writeOffInvoiceId,receiptCreditId,partialCreditId,partialApplicationId,earlierReceiptId,heldCreditId,refundCreditId,creditRefundId,start]}}});
  await prisma.payment.deleteMany({where:{id:paymentId}});
  await prisma.creditApplication.deleteMany({where:{id:partialApplicationId}});
  await prisma.customerCredit.deleteMany({where:{id:{in:[receiptCreditId,partialCreditId,heldCreditId,refundCreditId]}}});
  await prisma.refund.deleteMany({where:{id:creditRefundId}});
  await prisma.invoiceLineItem.deleteMany({where:{invoiceId:{in:[invoiceId,invalidInvoiceId,issuedLateInvoiceId,writeOffInvoiceId]}}});
  await prisma.invoice.deleteMany({where:{id:{in:[invoiceId,invalidInvoiceId,issuedLateInvoiceId,writeOffInvoiceId]}}});
  await prisma.receipt.deleteMany({where:{id:{in:[receiptId,lateReceiptId,earlierReceiptId]}}});
  await prisma.stripeBalanceTransaction.deleteMany({where:{id:stripeId}});
  await prisma.accountExportMapping.deleteMany({where:{ledgerAccountId:extraAccount??"none"}});
  if(extraAccount)await prisma.ledgerAccount.deleteMany({where:{id:extraAccount}});
  await prisma.accountingPeriod.deleteMany({where:{periodKey:month}});
  await prisma.auditLog.deleteMany({where:{userId:ownerId}});
  await prisma.systemIssue.deleteMany({where:{fingerprint:"books-post:INVOICE:"+invalidInvoiceId}});
  await prisma.businessSettings.update({where:{id:"singleton"},data:{booksStartDate:savedStart,badDebtTaxRecovery:savedBadDebtPolicy}});
  await prisma.customer.deleteMany({where:{id:customerId}});
  await prisma.user.deleteMany({where:{id:ownerId}});
});
describe("K-2A+K-2B source to immutable books",()=>{
  it("rejects unauthorized setup/read; initializes owner-attested opening once",async()=>{
    await expect(initializeBooks(staff,{startDate:start,bankCents:100,stripeCents:500,cardCents:0})).rejects.toBeInstanceOf(BooksPermissionError);
    await expect(getBooksWorkspace(guest)).rejects.toBeInstanceOf(BooksPermissionError);
    const priorEntries=await prisma.journalEntry.count();
    if(priorEntries===0) {
      await initializeBooks(actor,{startDate:start,bankCents:100,stripeCents:500,cardCents:0});
      expect(await prisma.journalEntry.count({where:{sourceType:"OPENING",sourceId:start}})).toBe(1);
    } else {
      // Other real-DB fixture files may already have immutable journals. Never
      // delete their evidence just to make this test pass; prove the fail-closed rule.
      await expect(initializeBooks(actor,{startDate:start,bankCents:100,stripeCents:500,cardCents:0})).rejects.toThrow(/already initialized/);
      await prisma.businessSettings.update({where:{id:"singleton"},data:{booksStartDate:new Date("2026-01-01T07:00:00Z")}});
    }
    await expect(initializeBooks(actor,{startDate:start,bankCents:100,stripeCents:500,cardCents:0})).rejects.toThrow(/already initialized/);
  });
  it("posts receipt, invoice and settled allocation as distinct balanced unique events",async()=>{
    await prisma.invoice.create({data:{id:invoiceId,customerId,status:"OPEN",amountDueCents:2500,
      lineItems:{create:{kind:"RENTAL",description:"Synthetic rental",amountCents:2500}}}});
    await prisma.receipt.create({data:{id:receiptId,customerId,source:"MANUAL",method:"CHECK",
      amountCents:2500,receivedOn:new Date("2026-10-17T18:00:00Z")}});
    await prisma.payment.create({data:{id:paymentId,invoiceId,receiptId,amountCents:2500,status:"succeeded"}});
    const attempt=()=>prisma.$transaction(tx=>postForSource(tx,"INVOICE",invoiceId),
      {isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    await Promise.allSettled(Array.from({length:8},attempt));
    expect(await prisma.journalEntry.count({where:{sourceType:"INVOICE",sourceId:invoiceId}})).toBe(1);
    await prisma.$transaction(tx=>postForSource(tx,"INVOICE",invoiceId));
    await prisma.$transaction(tx=>postForSource(tx,"RECEIPT",receiptId));
    // Backfill must find the lowercase canonical successful status, not only direct posting.
    await postPending({limit:500});
    expect(await prisma.journalEntry.count({where:{sourceId:{in:[invoiceId,receiptId,paymentId]}}})).toBe(3);
    const journal=await prisma.journalEntry.findMany({where:{sourceId:{in:[invoiceId,receiptId,paymentId]}},include:{lines:true}});
    for(const row of journal)expect(row.lines.reduce((n,x)=>n+x.debitCents-x.creditCents,0)).toBe(0);
    expect(journal.map(x=>x.eventKind).sort()).toEqual(["INVOICE_RECOGNIZED","PAYMENT_APPLIED","RECEIPT_RECEIVED"]);
    expect(journal.map(x=>x.periodKey)).toContain(month);
    expect((await getBooksWorkspace(actor,{month})).entries.length).toBeGreaterThan(0);
  });
  it("requires export before closing, shifts late events, records reason before reopen",async()=>{
    await expect(closeAccountingMonth(staff,month)).rejects.toBeInstanceOf(BooksPermissionError);
    await expect(closeAccountingMonth(actor,month)).rejects.toThrow(/Export every entry/);
    const exported=await exportMonthReview(actor,month);
    expect(exported.csv).toContain("Invoice recognized");
    await closeAccountingMonth(actor,month);
    const placed=await prisma.$transaction(tx=>journalPlacement(tx,new Date("2026-10-14T18:00:00Z")));
    expect(placed.periodKey).toBe("2026-11");
    expect(placed.lateForDate).not.toBeNull();
    await prisma.receipt.create({data:{id:lateReceiptId,customerId,source:"MANUAL",
      amountCents:117,method:"CASH",receivedOn:new Date("2026-10-14T18:00:00Z")}});
    await prisma.$transaction(tx=>postForSource(tx,"RECEIPT",lateReceiptId));
    const late=await prisma.journalEntry.findFirstOrThrow({where:{sourceType:"RECEIPT",sourceId:lateReceiptId}});
    expect(late.periodKey).toBe("2026-11");
    expect(late.memo).toMatch(/Late entry for 2026-10-14/);
    expect(late.lateForDate).not.toBeNull();
    await expect(reopenAccountingMonth(staff,month,"staff attempt")).rejects.toBeInstanceOf(BooksPermissionError);
    await expect(reopenAccountingMonth(actor,month,"")).rejects.toThrow(/nonempty/);
    await reopenAccountingMonth(actor,month,"Recorded correction to monthly accruals");
    expect((await prisma.accountingPeriod.findUnique({where:{periodKey:month}}))?.reopenedReason)
      .toBe("Recorded correction to monthly accruals");
  });
  it("allows owner changes with audit and protects owner accounts from staff",async()=>{
    await expect(addCustomAccount(staff,{name:"Vehicle",description:"For spending",type:"EXPENSE",isPaymentSource:false}))
      .rejects.toBeInstanceOf(BooksPermissionError);
    extraAccount=await addCustomAccount(actor,{name:"Travel expenses",description:"Owner-created expense",type:"EXPENSE",isPaymentSource:false});
    await renameAccount(actor,extraAccount,"Mileage costs");
    await mapExportAccount(actor,{accountId:extraAccount,target:"QBO_JOURNAL_CSV",externalName:"Vehicle:Travel"});
    const record=await prisma.ledgerAccount.findUnique({where:{id:extraAccount},include:{mappings:true}});
    expect(record?.name).toBe("Mileage costs");
    expect(record?.mappings[0]?.externalName).toBe("Vehicle:Travel");
    expect(await prisma.auditLog.count({where:{userId:ownerId,action:{startsWith:"books."}}})).toBeGreaterThan(2);
  });
  it("posts an invoice that includes a refundable deposit, holding the deposit as a liability, not income",async()=>{
    const depositInvoiceId="books-deposit-invoice-"+tag;
    await prisma.invoice.create({data:{id:depositInvoiceId,customerId,status:"OPEN",amountDueCents:3500,
      lineItems:{create:[{kind:"RENTAL",description:"First month",amountCents:1000},{kind:"DEPOSIT",description:"Security deposit",amountCents:2500}]}}});
    try {
      await prisma.$transaction(tx=>postForSource(tx,"INVOICE",depositInvoiceId));
      const entry=await prisma.journalEntry.findFirstOrThrow({where:{sourceType:"INVOICE",sourceId:depositInvoiceId,eventKind:"INVOICE_RECOGNIZED"},
        include:{lines:{include:{ledgerAccount:true}}}});
      const total=(side:"debitCents"|"creditCents")=>entry.lines.reduce((n,l)=>n+l[side],0);
      expect(total("debitCents")).toBe(3500);
      expect(total("creditCents")).toBe(3500);
      expect(entry.lines.find(l=>l.ledgerAccount.systemRole==="UNAPPLIED_RECEIPTS")?.creditCents).toBe(2500);
    } finally {
      await prisma.journalLine.deleteMany({where:{entry:{sourceId:depositInvoiceId}}});
      await prisma.journalEntry.deleteMany({where:{sourceId:depositInvoiceId}});
      await prisma.invoice.delete({where:{id:depositInvoiceId}}).catch(()=>undefined);
    }
  });
  it("writing off an unpaid deposit invoice reverses the parked deposit credit and books only the rent as bad debt",async()=>{
    const id="books-deposit-writeoff-"+tag;
    await prisma.businessSettings.update({where:{id:"singleton"},data:{badDebtTaxRecovery:"NO"}});
    await prisma.invoice.create({data:{id,customerId,status:"OPEN",amountDueCents:35000,amountPaidCents:0,
      writtenOffAt:new Date("2026-10-16T20:00:00Z"),
      lineItems:{create:[{kind:"RENTAL",description:"Rent",amountCents:10000},{kind:"DEPOSIT",description:"Security deposit",amountCents:25000}]}}});
    try {
      await prisma.$transaction(tx=>postForSource(tx,"INVOICE",id));
      const lines=async(eventKind:string)=>(await prisma.journalEntry.findFirstOrThrow({where:{sourceType:"INVOICE",sourceId:id,eventKind},
        include:{lines:{include:{ledgerAccount:true}}}})).lines;
      const net=(rows:Awaited<ReturnType<typeof lines>>,role:string)=>rows.filter(l=>l.ledgerAccount.systemRole===role).reduce((n,l)=>n+l.debitCents-l.creditCents,0);
      const all=[...await lines("INVOICE_RECOGNIZED"),...await lines("INVOICE_WRITTEN_OFF")];
      expect(net(all,"BAD_DEBT")).toBe(10000);
      expect(net(all,"UNAPPLIED_RECEIPTS")).toBe(0);
      expect(net(all,"RECEIVABLES")).toBe(0);
    } finally {
      await prisma.journalLine.deleteMany({where:{entry:{sourceId:id}}});
      await prisma.journalEntry.deleteMany({where:{sourceId:id}});
      await prisma.invoiceLineItem.deleteMany({where:{invoiceId:id}});
      await prisma.invoice.delete({where:{id}}).catch(()=>undefined);
    }
  });
  it("persists deduplicated exceptions for invalid money, without any partial journal",async()=>{
    await prisma.invoice.create({data:{
      id:invalidInvoiceId,customerId,status:"OPEN",amountDueCents:2600,
      lineItems:{create:{kind:"RENTAL",description:"Incomplete evidence",amountCents:2500}},
    }});
    const run=await postPending({limit:500});
    expect(run.problems.some(x=>x.sourceType==="INVOICE"&&x.sourceId===invalidInvoiceId)).toBe(true);
    expect(await prisma.journalEntry.count({where:{sourceType:"INVOICE",sourceId:invalidInvoiceId}})).toBe(0);
    const issue=await prisma.systemIssue.findUnique({where:{fingerprint:"books-post:INVOICE:"+invalidInvoiceId}});
    expect(issue?.status).toBe("OPEN");
    expect(issue?.detail).not.toContain("Incomplete evidence");
  });
  it("reconciles recorded Stripe fees without treating provider charges as a second receipt",async()=>{
    const at=new Date("2026-10-15T18:00:00Z");
    await prisma.stripeBalanceTransaction.create({data:{
      id:stripeId,type:"charge",reportingCategory:"charge",amountCents:1000,feeCents:36,
      netCents:964,currency:"usd",createdAtStripe:at,availableOn:at,
    }});
    await prisma.$transaction(tx=>postForSource(tx,"STRIPE_BALANCE_TXN",stripeId));
    const journals=await prisma.journalEntry.findMany({where:{sourceType:"STRIPE_BALANCE_TXN",sourceId:stripeId},
      include:{lines:true}});
    expect(journals.map(j=>j.eventKind)).toEqual(["STRIPE_FEE"]);
    expect(journals[0].lines.reduce((sum,line)=>sum+line.debitCents-line.creditCents,0)).toBe(0);
  });
  it("uses receipt-overpayment source evidence instead of false goodwill expense",async()=>{
    await prisma.customerCredit.create({data:{
      id:receiptCreditId,customerId,sourceType:"RECEIPT_OVERPAYMENT",sourceId:receiptId,
      reason:"Receipt overpayment",amountCents:300,remainingCents:300,
    }});
    await prisma.$transaction(tx=>postForSource(tx,"CUSTOMER_CREDIT",receiptCreditId));
    const entry=await prisma.journalEntry.findFirstOrThrow({where:{sourceType:"CUSTOMER_CREDIT",sourceId:receiptCreditId},
      include:{lines:{include:{ledgerAccount:true}}}});
    expect(entry.eventKind).toBe("CREDIT_FROM_RECEIPT");
    expect(entry.lines.some(line=>line.ledgerAccount.systemRole==="UNAPPLIED_RECEIPTS"&&line.debitCents===300)).toBe(true);
  });
  it("treats a late payment kept as credit as received money, not a goodwill expense",async()=>{
    await prisma.customerCredit.create({data:{
      id:heldCreditId,customerId,sourceType:"HELD_PAYMENT",sourceId:paymentId,
      reason:"Payment received after an invoice was closed",amountCents:400,remainingCents:400,
    }});
    await prisma.$transaction(tx=>postForSource(tx,"CUSTOMER_CREDIT",heldCreditId));
    const entry=await prisma.journalEntry.findFirstOrThrow({where:{sourceType:"CUSTOMER_CREDIT",sourceId:heldCreditId},
      include:{lines:{include:{ledgerAccount:true}}}});
    expect(entry.eventKind).toBe("CREDIT_FROM_RECEIPT");
    expect(entry.lines.some(line=>line.ledgerAccount.systemRole==="UNAPPLIED_RECEIPTS"&&line.debitCents===400)).toBe(true);
    expect(entry.lines.some(line=>line.ledgerAccount.systemRole==="CREDITS_GIVEN")).toBe(false);
  });
  it("does not double-book a held-payment credit that was already posted as goodwill before the correction",async()=>{
    const legacyId="books-legacy-held-"+tag;
    await prisma.customerCredit.create({data:{
      id:legacyId,customerId,sourceType:"HELD_PAYMENT",sourceId:"legacy-held-source-"+tag,
      reason:"Payment received after an invoice was closed",amountCents:250,remainingCents:250,
    }});
    try {
      // Simulate the old behavior: a goodwill-style entry already exists for this source.
      const accounts=await prisma.ledgerAccount.findMany({where:{systemRole:{in:["CREDITS_GIVEN","CUSTOMER_CREDITS"]}}});
      const given=accounts.find(a=>a.systemRole==="CREDITS_GIVEN")!,owed=accounts.find(a=>a.systemRole==="CUSTOMER_CREDITS")!;
      await prisma.journalEntry.create({data:{sourceType:"CUSTOMER_CREDIT",sourceId:legacyId,eventKind:"CREDIT_GRANTED",
        entryDate:new Date("2026-10-10T12:00:00Z"),periodKey:"2026-10",memo:"Legacy goodwill entry",
        lines:{create:[{ledgerAccountId:given.id,debitCents:250,creditCents:0},{ledgerAccountId:owed.id,debitCents:0,creditCents:250}]}}});
      await prisma.$transaction(tx=>postForSource(tx,"CUSTOMER_CREDIT",legacyId));
      const entries=await prisma.journalEntry.findMany({where:{sourceType:"CUSTOMER_CREDIT",sourceId:legacyId}});
      expect(entries.map(e=>e.eventKind)).toEqual(["CREDIT_GRANTED"]);
    } finally {
      await prisma.journalLine.deleteMany({where:{entry:{sourceId:legacyId}}});
      await prisma.journalEntry.deleteMany({where:{sourceId:legacyId}});
      await prisma.customerCredit.deleteMany({where:{id:legacyId}});
    }
  });
  it("books a refund kept as store credit once, with no money leaving the bank",async()=>{
    await prisma.refund.create({data:{id:creditRefundId,invoiceId,amountCents:500,reason:"OTHER"}});
    await prisma.customerCredit.create({data:{
      id:refundCreditId,customerId,sourceType:"REFUND_TO_CREDIT",sourceId:creditRefundId,
      reason:"Invoice refund — other",amountCents:500,remainingCents:500,
    }});
    await prisma.$transaction(tx=>postForSource(tx,"REFUND",creditRefundId));
    await prisma.$transaction(tx=>postForSource(tx,"CUSTOMER_CREDIT",refundCreditId));
    expect(await prisma.journalEntry.count({where:{sourceType:"REFUND",sourceId:creditRefundId}})).toBe(0);
    const entry=await prisma.journalEntry.findFirstOrThrow({where:{sourceType:"CUSTOMER_CREDIT",sourceId:refundCreditId},
      include:{lines:{include:{ledgerAccount:true}}}});
    expect(entry.lines.some(line=>line.ledgerAccount.systemRole==="REFUNDS"&&line.debitCents===500)).toBe(true);
    expect(entry.lines.some(line=>line.ledgerAccount.systemRole==="CUSTOMER_CREDITS"&&line.creditCents===500)).toBe(true);
  });
  it("does not double-subtract applied credits from an invoice write-off",async()=>{
    await prisma.businessSettings.update({where:{id:"singleton"},data:{badDebtTaxRecovery:"NO"}});
    await prisma.invoice.create({data:{id:writeOffInvoiceId,customerId,status:"OPEN",amountDueCents:10000,amountPaidCents:3000,
      writtenOffAt:new Date("2026-10-16T20:00:00Z"),lineItems:{create:{kind:"RENTAL",description:"Write-off ledger fixture",amountCents:10000}}}});
    await prisma.customerCredit.create({data:{id:partialCreditId,customerId,reason:"Synthetic applied credit",
      amountCents:3000,remainingCents:0}});
    await prisma.creditApplication.create({data:{id:partialApplicationId,creditId:partialCreditId,
      invoiceId:writeOffInvoiceId,amountCents:3000}});
    await prisma.$transaction(tx=>postForSource(tx,"INVOICE",writeOffInvoiceId));
    const entry=await prisma.journalEntry.findFirstOrThrow({where:{sourceType:"INVOICE",sourceId:writeOffInvoiceId,
      eventKind:"INVOICE_WRITTEN_OFF"},include:{lines:true}});
    expect(entry.lines.filter(x=>x.debitCents).reduce((n,x)=>n+x.debitCents,0)).toBe(7000);
  });
  it("includes formerly drafted invoices issued after accounting begins and globally ranks an earlier cash receipt",async()=>{
    await prisma.invoice.create({data:{id:issuedLateInvoiceId,customerId,status:"OPEN",amountDueCents:2700,
      createdAt:new Date("2025-12-15T19:00:00Z"),issuedAt:new Date("2026-10-12T19:00:00Z"),
      lineItems:{create:{kind:"RENTAL",description:"Post-start issued invoice",amountCents:2700}}}});
    await postPending({limit:500});
    expect(await prisma.journalEntry.count({where:{sourceType:"INVOICE",sourceId:issuedLateInvoiceId,
      eventKind:"INVOICE_RECOGNIZED"}})).toBe(1);
    await prisma.receipt.create({data:{id:earlierReceiptId,customerId,source:"MANUAL",method:"CHECK",amountCents:125,
      receivedOn:new Date("2026-02-15T19:00:00Z")}});
    const result=await postPending({limit:1});
    expect(result.posted).toBe(1);
    expect(await prisma.journalEntry.count({where:{sourceType:"RECEIPT",sourceId:earlierReceiptId,
      eventKind:"RECEIPT_RECEIVED"}})).toBe(1);
  });
  it("bounded backfill never double-applies settled source events",async()=>{
    const out=await postPending({limit:12});
    expect(out.posted).toBeGreaterThanOrEqual(0);
    expect(await prisma.journalEntry.count({where:{sourceType:"INVOICE",sourceId:invoiceId}})).toBe(1);
  });
});
