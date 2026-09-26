/**
 * One-time setup script: creates Chris's OWNER account.
 *
 * This does NOT run automatically on deploy (see docs/HANDOFF.md for why —
 * short version: it needs OWNER_EMAIL/OWNER_PASSWORD secrets set once, then
 * should not run again). Run it by hand, once, after the app is deployed
 * and the database is reachable:
 *
 *   OWNER_EMAIL=you@example.com OWNER_PASSWORD='a-strong-password' npm run db:seed
 *
 * It is safe to re-run — if the OWNER_EMAIL account already exists, it's
 * left untouched (and merely promoted to OWNER if it wasn't already).
 */
import { auth } from "../src/lib/auth";
import { prisma } from "../src/lib/prisma";

async function main() {
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;
  const name = process.env.OWNER_NAME ?? "Chris Robinson";

  if (!email || !password) {
    throw new Error(
      "Set OWNER_EMAIL and OWNER_PASSWORD environment variables before running this script.",
    );
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

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
