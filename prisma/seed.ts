/**
 * One-time-ish setup script, in three independent parts:
 *
 * 1. Business content (BusinessSettings singleton + starter
 *    ApplianceType rows) — always runs, needs no secrets, and is safe to
 *    run any number of times (every write is an idempotent upsert). This
 *    is what gives the public site real data to render instead of an
 *    empty pricing page, and is why CI runs `npm run db:seed` against
 *    its throwaway database before the accessibility tests.
 * 2. Chris's OWNER account — only runs if OWNER_EMAIL and OWNER_PASSWORD
 *    are set. Safe to re-run: if that email already exists, it's left
 *    untouched (and merely promoted to OWNER if it wasn't already).
 *
 *   OWNER_EMAIL=you@example.com OWNER_PASSWORD='a-strong-password' npm run db:seed
 *
 * 3. A test-only CUSTOMER account with one signed agreement and a paid
 *    invoice — only runs if TEST_CUSTOMER_EMAIL and TEST_CUSTOMER_PASSWORD
 *    are set. This exists purely so the accessibility test suite
 *    (e2e/accessibility-authenticated.spec.ts) has a real, logged-in-able
 *    account with actual data in its tables to check /desk/** and
 *    /account/** pages against — CI sets this (and OWNER_EMAIL/
 *    OWNER_PASSWORD) against its own throwaway database; never set either
 *    of these against the real production database.
 */
import { auth } from "../src/lib/auth";
import { prisma } from "../src/lib/prisma";
import { generateReferralCode } from "../src/domains/referrals/code";

// Starting catalog: Chris is launching with washers and dryers only, with
// more appliance categories (refrigerators, ranges, dishwashers, ...)
// planned later — see docs/ROADMAP.md. Adding those later is purely a
// data change (new rows here or in /desk/settings), never a code change,
// per docs/BUSINESS-RULES.md. Prices match the defaults documented there.
// photoUrl points at a real photo of a basic/representative model (see
// public/appliances/ — Chris supplied these), not a stock photo of any
// specific branded unit, per the "actual appliance may vary" disclaimer
// shown everywhere these appear.
const STARTER_APPLIANCE_TYPES = [
  {
    name: "Washer + Dryer Set",
    slug: "washer-dryer-set",
    monthlyPriceCents: 6000,
    sortOrder: 0,
    photoUrl: "/appliances/washer-dryer-set.jpg",
  },
  {
    name: "Washer",
    slug: "washer",
    monthlyPriceCents: 3500,
    sortOrder: 1,
    photoUrl: "/appliances/washer.jpg",
  },
  {
    name: "Dryer",
    slug: "dryer",
    monthlyPriceCents: 3500,
    sortOrder: 2,
    photoUrl: "/appliances/dryer.jpg",
  },
];

async function seedBusinessContent() {
  await prisma.businessSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });

  for (const applianceType of STARTER_APPLIANCE_TYPES) {
    await prisma.applianceType.upsert({
      where: { slug: applianceType.slug },
      update: {},
      create: { ...applianceType, showOnWebsite: true },
    });
  }

  console.log(
    "Business content ready: BusinessSettings singleton + starter appliance types.",
  );
}

async function seedOwnerAccount() {
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;
  const name = process.env.OWNER_NAME ?? "Chris Robinson";

  if (!email || !password) {
    console.log(
      "OWNER_EMAIL/OWNER_PASSWORD not set — skipping owner account setup (business content still seeded).",
    );
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    // emailVerified: true here too (Task #70) — an already-existing
    // account re-running this script (e.g. every CI run) must stay
    // able to log in once requireEmailVerification is on, same as a
    // brand-new one below.
    await prisma.user.update({
      where: { email },
      data: { role: "OWNER", emailVerified: true },
    });
    console.log(`"${email}" already existed — made sure its role is OWNER.`);
    return;
  }

  await auth.api.signUpEmail({
    body: { email, password, name },
  });

  // emailVerified: true (Task #70) — this account is created directly
  // with a known password (unlike a real customer/staff account, which
  // goes through the activation-email flow), so there's no separate
  // "proof of inbox control" step to piggyback on. Chris himself is
  // typing this email into a one-time seed command he runs, so treating
  // it as verified is the same trust level as any other owner-set-up
  // step in this app. Without this, requireEmailVerification would
  // block his very first login.
  await prisma.user.update({
    where: { email },
    data: { role: "OWNER", emailVerified: true },
  });

  console.log(`Created OWNER account for ${email}.`);
}

async function seedTestCustomerFixture() {
  const email = process.env.TEST_CUSTOMER_EMAIL;
  const password = process.env.TEST_CUSTOMER_PASSWORD;
  const name = process.env.TEST_CUSTOMER_NAME ?? "Test Customer";

  if (!email || !password) {
    console.log(
      "TEST_CUSTOMER_EMAIL/TEST_CUSTOMER_PASSWORD not set — skipping the accessibility-test customer fixture (only used by e2e tests, never in production).",
    );
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`"${email}" already existed — leaving its data as-is.`);
    return;
  }

  await auth.api.signUpEmail({ body: { email, password, name } });
  // emailVerified: true (Task #70) — this is a CI-only test fixture
  // logged into directly by e2e/global-setup.ts; without this, every
  // e2e run would fail at login the same way a real unverified account
  // would. See the OWNER account comment above for the same reasoning.
  const user = await prisma.user.update({
    where: { email },
    data: { role: "CUSTOMER", emailVerified: true },
  });

  const customer = await prisma.customer.create({
    data: { userId: user.id, referralCode: generateReferralCode() },
  });

  const serviceAddress = await prisma.serviceAddress.create({
    data: {
      customerId: customer.id,
      line1: "123 Test St",
      city: "Denver",
      zip: "80201",
    },
  });

  const agreement = await prisma.rentalAgreement.create({
    data: {
      customerId: customer.id,
      serviceAddressId: serviceAddress.id,
      status: "ACTIVE",
      startDate: new Date(),
      depositCents: 15000,
      taxRatePermille: 73, // 7.3%
    },
  });

  await prisma.rentalLine.create({
    data: {
      agreementId: agreement.id,
      label: "Washer + Dryer Set",
      monthlyPriceCents: 6000,
      listPriceCents: 6000,
    },
  });

  // One paid invoice so the billing tables (/desk/billing,
  // /account/billing) render real rows, not just their empty state —
  // both matter for accessibility (a table's semantics are only really
  // exercised once it has data in it).
  const invoice = await prisma.invoice.create({
    data: {
      customerId: customer.id,
      agreementId: agreement.id,
      status: "PAID",
      billingPeriodStart: new Date(),
      billingPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      subtotalCents: 6000,
      taxCents: 438,
      amountDueCents: 21438,
      amountPaidCents: 21438,
      lineItems: {
        createMany: {
          data: [
            { kind: "RENTAL", description: "Washer + Dryer Set", amountCents: 6000 },
            { kind: "DEPOSIT", description: "Security deposit", amountCents: 15000 },
            { kind: "TAX", description: "Sales tax", amountCents: 438 },
          ],
        },
      },
    },
  });

  await prisma.payment.create({
    data: {
      invoiceId: invoice.id,
      amountCents: 21438,
      method: "card",
      status: "succeeded",
    },
  });

  console.log(
    `Created e2e-test CUSTOMER account for ${email}, with one signed agreement and a paid invoice.`,
  );
}

async function main() {
  await seedBusinessContent();
  await seedOwnerAccount();
  await seedTestCustomerFixture();
  await seedStaffSecurityFixture();
}

async function seedStaffSecurityFixture() {
  const email = process.env.TEST_STAFF_EMAIL;
  const password = process.env.TEST_STAFF_PASSWORD;
  if (!email || !password) return;
  const target = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.CI !== "true" || target.hostname !== "localhost" || target.pathname !== "/appliance_desk_test") {
    throw new Error("Staff security fixtures require CI's disposable localhost database.");
  }
  if (!await prisma.user.findUnique({ where: { email } })) {
    await auth.api.signUpEmail({ body: { email, password, name: "CI Staff" } });
  }
  await prisma.user.update({ where: { email }, data: { role: "STAFF", emailVerified: true } });
  const customer = await prisma.customer.findFirstOrThrow({
    where: { user: { email: process.env.TEST_CUSTOMER_EMAIL } },
    include: { serviceAddresses: true, rentalAgreements: { include: { lines: true } } },
  });
  const address = customer.serviceAddresses[0]!;
  const agreement = customer.rentalAgreements[0]!;
  await prisma.rentalLine.update({ where: { id: agreement.lines[0]!.id },
    data: { label: "Restricted rental price 782341", monthlyPriceCents: 782341 } });
  const type = await prisma.applianceType.findFirstOrThrow();
  const appliance = await prisma.appliance.upsert({ where: { id: "ci-security-appliance" },
    create: { id: "ci-security-appliance", assetNumber: "CI-SECURITY-UNIT", applianceTypeId: type.id, acquisitionCostCents: 8675309 },
    update: {} });
  await prisma.job.upsert({ where: { id: "ci-security-job" }, create: {
    id: "ci-security-job", type: "MAINTENANCE_VISIT", status: "IN_PROGRESS",
    customerId: customer.id, serviceAddressId: address.id, agreementId: agreement.id,
    partsCostCents: 932187, laborCostCents: 782341,
    checklist: [{ item: "CI operational check", checked: false }],
    appliances: { create: { applianceId: appliance.id } },
  }, update: {} });
  const otherUser = await prisma.user.upsert({ where: { id: "ci-isolation-other-user" },
    create: { id: "ci-isolation-other-user", name: "Other Customer", email: "ci-other@example.test", role: "CUSTOMER" }, update: {} });
  await prisma.customer.upsert({ where: { id: "ci-isolation-other-customer" },
    create: { id: "ci-isolation-other-customer", userId: otherUser.id, referralCode: "CI-OTHER" }, update: {} });
  await prisma.invoice.upsert({ where: { id: "ci-isolation-other-invoice" },
    create: { id: "ci-isolation-other-invoice", customerId: "ci-isolation-other-customer", status: "OPEN",
      subtotalCents: 9876543, amountDueCents: 9876543 }, update: {} });
  console.log("Created CI-only staff security and customer isolation fixtures.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
