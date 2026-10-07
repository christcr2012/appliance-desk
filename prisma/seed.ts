/**
 * One-time-ish setup script, in three independent parts:
 *
 * 1. Business content (BusinessSettings singleton + starter ApplianceType rows)
 *    — always runs, needs no secrets, and is safe to run any number of times.
 * 2. Chris's OWNER account — only runs if OWNER_EMAIL and OWNER_PASSWORD are set.
 * 3. Test-only CUSTOMER/STAFF accounts used only in CI's disposable local
 *    Postgres database for authenticated browser/security acceptance.
 *
 * Public Better Auth signup is intentionally disabled. These trusted setup
 * flows create Better Auth-compatible credential rows directly through the
 * same server-only provisioning helper production customer/staff workflows use.
 */
import { prisma } from "../src/lib/prisma";
import { generateReferralCode } from "../src/domains/referrals/code";
import { TAX_CHARGE_CATEGORIES } from "../src/domains/tax/categories";
import {
  createTrustedCredentialUserInTx,
  normalizeAccountEmail,
} from "../src/lib/account-provisioning";

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
  const rawEmail = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;
  const name = process.env.OWNER_NAME ?? "Chris Robinson";

  if (!rawEmail || !password) {
    console.log(
      "OWNER_EMAIL/OWNER_PASSWORD not set — skipping owner account setup (business content still seeded).",
    );
    return;
  }

  const email = normalizeAccountEmail(rawEmail);
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    await prisma.user.update({
      where: { email },
      data: { role: "OWNER", emailVerified: true },
    });
    console.log(`"${email}" already existed — made sure its role is OWNER.`);
    return;
  }

  await prisma.$transaction((tx) =>
    createTrustedCredentialUserInTx(tx, {
      email,
      password,
      name,
      role: "OWNER",
      emailVerified: true,
    }),
  );

  console.log(`Created OWNER account for ${email}.`);
}

async function seedCiTaxReadyAddress(serviceAddressId: string) {
  const target = new URL(process.env.DATABASE_URL ?? "");
  if (
    process.env.CI !== "true" ||
    !["localhost", "127.0.0.1"].includes(target.hostname) ||
    target.pathname !== "/appliance_desk_test"
  ) {
    return;
  }

  const jurisdictionId = "ci-tax-ready-jurisdiction";
  const rateVersionId = "ci-tax-ready-rate";
  const effectiveFrom = new Date("2020-01-01T07:00:00.000Z");

  await prisma.taxJurisdiction.upsert({
    where: { id: jurisdictionId },
    update: {
      name: "Synthetic CI tax jurisdiction",
      administration: "STATE_COLLECTED",
      reviewStatus: "REVIEWED",
    },
    create: {
      id: jurisdictionId,
      code: "CI-TAX-READY",
      name: "Synthetic CI tax jurisdiction",
      level: "CITY",
      administration: "STATE_COLLECTED",
      reviewStatus: "REVIEWED",
    },
  });
  await prisma.taxRateVersion.upsert({
    where: { id: rateVersionId },
    update: { rateMilliPercent: 1000, effectiveFrom, source: "MANUAL" },
    create: {
      id: rateVersionId,
      jurisdictionId,
      rateMilliPercent: 1000,
      effectiveFrom,
      source: "MANUAL",
    },
  });
  for (const category of TAX_CHARGE_CATEGORIES) {
    await prisma.taxabilityRule.upsert({
      where: { jurisdictionId_category: { jurisdictionId, category } },
      update: { taxability: "TAXABLE", reason: "Synthetic CI fixture" },
      create: {
        jurisdictionId,
        category,
        taxability: "TAXABLE",
        reason: "Synthetic CI fixture",
      },
    });
  }
  await prisma.addressTaxLocation.updateMany({
    where: { serviceAddressId, isCurrent: true },
    data: { isCurrent: false },
  });
  await prisma.addressTaxLocation.create({
    data: {
      serviceAddressId,
      status: "VERIFIED",
      source: "MANUAL",
      lookedUpAt: new Date(),
      jurisdictions: { create: { jurisdictionId } },
    },
  });
}

async function seedTestCustomerFixture() {
  const rawEmail = process.env.TEST_CUSTOMER_EMAIL;
  const password = process.env.TEST_CUSTOMER_PASSWORD;
  const name = process.env.TEST_CUSTOMER_NAME ?? "Test Customer";

  if (!rawEmail || !password) {
    console.log(
      "TEST_CUSTOMER_EMAIL/TEST_CUSTOMER_PASSWORD not set — skipping the accessibility-test customer fixture (only used by e2e tests, never in production).",
    );
    return;
  }

  const email = normalizeAccountEmail(rawEmail);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`"${email}" already existed — leaving its data as-is.`);
    return;
  }

  const user = await prisma.$transaction((tx) =>
    createTrustedCredentialUserInTx(tx, {
      email,
      password,
      name,
      role: "CUSTOMER",
      emailVerified: true,
    }),
  );

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
  await seedCiTaxReadyAddress(serviceAddress.id);

  const agreement = await prisma.rentalAgreement.create({
    data: {
      customerId: customer.id,
      serviceAddressId: serviceAddress.id,
      status: "ACTIVE",
      startDate: new Date(),
      depositCents: 15000,
      taxRateMilliPercent: 7300,
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

  const receivedOn = new Date();
  const invoice = await prisma.invoice.create({
    data: {
      customerId: customer.id,
      agreementId: agreement.id,
      status: "PAID",
      billingPeriodStart: receivedOn,
      billingPeriodEnd: new Date(receivedOn.getTime() + 30 * 24 * 60 * 60 * 1000),
      subtotalCents: 6000,
      taxCents: 438,
      amountDueCents: 21438,
      amountPaidCents: 21438,
      lineItems: {
        createMany: {
          data: [
            {
              kind: "RENTAL",
              description: "Washer + Dryer Set",
              amountCents: 6000,
            },
            {
              kind: "DEPOSIT",
              description: "Security deposit",
              amountCents: 15000,
            },
            { kind: "TAX", description: "Sales tax", amountCents: 438 },
          ],
        },
      },
    },
  });

  const receipt = await prisma.receipt.create({
    data: {
      customerId: customer.id,
      source: "STRIPE",
      amountCents: 21438,
      method: "card",
      receivedOn,
    },
  });
  await prisma.payment.create({
    data: {
      invoiceId: invoice.id,
      receiptId: receipt.id,
      amountCents: 21438,
      method: "card",
      status: "succeeded",
    },
  });

  console.log(
    `Created e2e-test CUSTOMER account for ${email}, with one signed agreement and a paid invoice.`,
  );
}

async function seedStaffSecurityFixture() {
  const rawEmail = process.env.TEST_STAFF_EMAIL;
  const password = process.env.TEST_STAFF_PASSWORD;
  if (!rawEmail || !password) return;

  const target = new URL(process.env.DATABASE_URL ?? "");
  if (
    process.env.CI !== "true" ||
    target.hostname !== "localhost" ||
    target.pathname !== "/appliance_desk_test"
  ) {
    throw new Error("Staff security fixtures require CI's disposable localhost database.");
  }

  const email = normalizeAccountEmail(rawEmail);
  if (!(await prisma.user.findUnique({ where: { email } }))) {
    await prisma.$transaction((tx) =>
      createTrustedCredentialUserInTx(tx, {
        email,
        password,
        name: "CI Staff",
        role: "STAFF",
        emailVerified: true,
      }),
    );
  }
  await prisma.user.update({
    where: { email },
    data: { role: "STAFF", emailVerified: true },
  });

  const customer = await prisma.customer.findFirstOrThrow({
    where: { user: { email: normalizeAccountEmail(process.env.TEST_CUSTOMER_EMAIL!) } },
    include: {
      serviceAddresses: true,
      rentalAgreements: { include: { lines: true } },
    },
  });
  const address = customer.serviceAddresses[0]!;
  const agreement = customer.rentalAgreements[0]!;
  await prisma.rentalLine.update({
    where: { id: agreement.lines[0]!.id },
    data: {
      label: "Restricted rental price 782341",
      monthlyPriceCents: 782341,
    },
  });
  const type = await prisma.applianceType.findFirstOrThrow();
  const appliance = await prisma.appliance.upsert({
    where: { id: "ci-security-appliance" },
    create: {
      id: "ci-security-appliance",
      assetNumber: "CI-SECURITY-UNIT",
      applianceTypeId: type.id,
      acquisitionCostCents: 8675309,
    },
    update: {},
  });
  await prisma.job.upsert({
    where: { id: "ci-security-job" },
    create: {
      id: "ci-security-job",
      type: "MAINTENANCE_VISIT",
      status: "IN_PROGRESS",
      customerId: customer.id,
      serviceAddressId: address.id,
      agreementId: agreement.id,
      partsCostCents: 932187,
      laborCostCents: 782341,
      checklist: [{ item: "CI operational check", checked: false }],
      appliances: { create: { applianceId: appliance.id } },
    },
    update: {},
  });
  const otherUser = await prisma.user.upsert({
    where: { id: "ci-isolation-other-user" },
    create: {
      id: "ci-isolation-other-user",
      name: "Other Customer",
      email: "ci-other@example.test",
      role: "CUSTOMER",
    },
    update: {},
  });
  await prisma.customer.upsert({
    where: { id: "ci-isolation-other-customer" },
    create: {
      id: "ci-isolation-other-customer",
      userId: otherUser.id,
      referralCode: "CI-OTHER",
    },
    update: {},
  });
  await prisma.invoice.upsert({
    where: { id: "ci-isolation-other-invoice" },
    create: {
      id: "ci-isolation-other-invoice",
      customerId: "ci-isolation-other-customer",
      status: "OPEN",
      subtotalCents: 9876543,
      amountDueCents: 9876543,
    },
    update: {},
  });
  console.log("Created CI-only staff security and customer isolation fixtures.");
}

async function main() {
  await seedBusinessContent();
  await seedOwnerAccount();
  await seedTestCustomerFixture();
  await seedStaffSecurityFixture();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());