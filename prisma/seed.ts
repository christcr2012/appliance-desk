/**
 * One-time-ish setup script, in two independent parts:
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
 */
import { auth } from "../src/lib/auth";
import { prisma } from "../src/lib/prisma";

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
    await prisma.user.update({
      where: { email },
      data: { role: "OWNER" },
    });
    console.log(`"${email}" already existed — made sure its role is OWNER.`);
    return;
  }

  await auth.api.signUpEmail({
    body: { email, password, name },
  });

  await prisma.user.update({
    where: { email },
    data: { role: "OWNER" },
  });

  console.log(`Created OWNER account for ${email}.`);
}

async function main() {
  await seedBusinessContent();
  await seedOwnerAccount();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
