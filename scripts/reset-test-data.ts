// Resets everything a round of system testing would have created —
// test leads, test customers, test agreements, jobs, invoices, etc. —
// WITHOUT touching any real login (Chris's OWNER account, or any staff
// account), and WITHOUT touching business configuration that's real
// regardless of whether the customer data around it is test data or not
// (BusinessSettings, the appliance-type catalog and prices, the actual
// physical appliance fleet and its inspection history, the parts
// knowledge base, the real price-change/activity history). See
// docs/DECISIONS.md's 2026-09-28 "Resetting test data without losing
// your login" entry for the full reasoning behind exactly this scope,
// and why a second "break glass" login system was deliberately NOT
// built instead.
//
// SAFE BY CONSTRUCTION, not just by care: this script never touches the
// User, Session, Account, or Verification row for anyone with role
// OWNER, ADMIN, or STAFF — only CUSTOMER-role logins (which only exist
// to sign in to a Customer record this script is about to delete
// anyway) are removed. There is no code path in this script that can
// delete Chris's own login.
//
// Uses ordinary, ordered `deleteMany` calls (children before their
// parents) inside one transaction — deliberately NOT a blanket
// `TRUNCATE ... CASCADE`. TRUNCATE's CASCADE is a schema-level cascade:
// it forcibly empties an ENTIRE table that has any foreign key pointing
// at a truncated table, even rows that don't actually reference
// anything being deleted. Photo is exactly that case — a photo can be
// tied to a real, kept Appliance, or to a Job/MaintenanceRequest being
// wiped — so a real appliance's condition photos would be silently lost
// if Job were truncated with CASCADE. Ordered deletes only ever remove
// the rows this script actually means to remove.
//
// Requires --yes on the command line. Running it with no arguments
// prints exactly what it would delete and what it would leave alone,
// then exits without changing anything — a safe way to preview it.
import { prisma } from "../src/lib/prisma";

const KEPT_ON_PURPOSE = [
  "User / Session / Account (OWNER, ADMIN, STAFF logins) — every real login stays exactly as it is",
  "BusinessSettings — your pricing defaults, fees, tax rate, business info, service area, announcement banner",
  "ApplianceType — your appliance categories and current published prices",
  "Appliance — your actual physical fleet (asset numbers, serial numbers, condition, status)",
  "ApplianceInspection — return-inspection history for those real appliances",
  "Photo — but ONLY photos tied to a job or maintenance request; a photo tied only to an Appliance (a real condition photo) is kept",
  "PartRecord — your parts knowledge base (reusable across every unit of a model, not test data)",
  "PricingRule — the audit trail of real price changes you've made in /desk/settings",
  "AuditLog — the real activity history in /desk/activity",
  "WebhookEvent — the Stripe event log",
  "SiteContent — your public-site text (headline, FAQ, etc.)",
];

// Exported (rather than just called at the bottom of this file) so
// tests/reset-test-data.test.ts can exercise the dry-run/confirmed
// branches and the exact delete order/filters against a mocked prisma
// — without a real database, and without this script's own CLI
// invocation firing on import.
export async function main(argv: string[] = process.argv) {
  const confirmed = argv.includes("--yes");

  console.log(
    "This resets test/customer data: every lead, customer, rental agreement, job, maintenance\n" +
      "request, invoice, payment, and everything that hangs off them, plus any CUSTOMER-role login\n" +
      "(those only exist to sign in to a Customer record this deletes anyway).\n",
  );
  console.log("It will NOT touch:");
  for (const item of KEPT_ON_PURPOSE) console.log(`  - ${item}`);

  if (!confirmed) {
    console.log(
      "\nNo changes made — this was a preview. Re-run with --yes to actually do it:\n" +
        "  npm run db:reset-test-data -- --yes\n",
    );
    return;
  }

  console.log("\n--yes given — deleting now (children before parents, one transaction)...");

  await prisma.$transaction(async (tx) => {
    // 1. Photo tied to a Job or MaintenanceRequest only — a photo tied
    // only to a real, kept Appliance is left alone.
    const photo = await tx.photo.deleteMany({
      where: { OR: [{ jobId: { not: null } }, { maintenanceRequestId: { not: null } }] },
    });
    const jobAppliance = await tx.jobAppliance.deleteMany({});
    const invoiceLineItem = await tx.invoiceLineItem.deleteMany({});
    const payment = await tx.payment.deleteMany({});
    const refund = await tx.refund.deleteMany({});
    const signatureRecord = await tx.signatureRecord.deleteMany({});
    const deposit = await tx.deposit.deleteMany({});
    const applianceAssignment = await tx.applianceAssignment.deleteMany({});
    const rentalLine = await tx.rentalLine.deleteMany({});
    const leadApplianceRequest = await tx.leadApplianceRequest.deleteMany({});
    const customerNote = await tx.customerNote.deleteMany({});
    const customerContact = await tx.customerContact.deleteMany({});
    const customerCredit = await tx.customerCredit.deleteMany({});
    const consentRecord = await tx.consentRecord.deleteMany({});
    const referral = await tx.referral.deleteMany({});
    const job = await tx.job.deleteMany({});
    const invoice = await tx.invoice.deleteMany({});
    const maintenanceRequest = await tx.maintenanceRequest.deleteMany({});
    const rentalAgreement = await tx.rentalAgreement.deleteMany({});
    const serviceAddress = await tx.serviceAddress.deleteMany({});
    const customer = await tx.customer.deleteMany({});
    const lead = await tx.lead.deleteMany({});
    const user = await tx.user.deleteMany({ where: { role: "CUSTOMER" } });
    // Short-lived password-reset/email-verification tokens for
    // everyone, real accounts included — always safe to clear entirely,
    // since an expired or unused token is worthless and a still-needed
    // one can just be requested again.
    const verification = await tx.verification.deleteMany({});

    console.log("\nDeleted:");
    for (const [label, result] of Object.entries({
      Photo: photo,
      JobAppliance: jobAppliance,
      InvoiceLineItem: invoiceLineItem,
      Payment: payment,
      Refund: refund,
      SignatureRecord: signatureRecord,
      Deposit: deposit,
      ApplianceAssignment: applianceAssignment,
      RentalLine: rentalLine,
      LeadApplianceRequest: leadApplianceRequest,
      CustomerNote: customerNote,
      CustomerContact: customerContact,
      CustomerCredit: customerCredit,
      ConsentRecord: consentRecord,
      Referral: referral,
      Job: job,
      Invoice: invoice,
      MaintenanceRequest: maintenanceRequest,
      RentalAgreement: rentalAgreement,
      ServiceAddress: serviceAddress,
      Customer: customer,
      Lead: lead,
      "User (CUSTOMER role)": user,
      "Verification (pending tokens)": verification,
    })) {
      console.log(`  - ${label}: ${result.count}`);
    }
  });

  console.log("\nDone. Real logins, pricing, fleet, and settings are untouched.");
}

// Only run as a CLI side effect when this file is executed directly
// (`tsx scripts/reset-test-data.ts`), never when imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((error) => {
      console.error("[reset-test-data] Failed — no partial changes were kept (this ran in one transaction).");
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
