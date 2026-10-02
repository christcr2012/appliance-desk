/**
 * Creates ONE disposable customer login for a browser test, using the same
 * trusted provisioning path the real app uses (src/lib/account-provisioning.ts).
 *
 * Public sign-up is intentionally disabled in production (see src/lib/auth.ts),
 * so tests can no longer create accounts by calling /api/auth/sign-up/email.
 * Playwright's own worker cannot import Better Auth (it uses a separate ESM
 * loader), so e2e specs run this script in a child process instead.
 *
 * Usage: npx tsx scripts/create-ci-login.ts <email> <password>
 * Prints the new user's id on stdout.
 *
 * Safety: refuses to run unless CI=true and DATABASE_URL points at the
 * disposable local test database. It can never touch real data.
 */
import { prisma } from "../src/lib/prisma";
import { createTrustedCredentialUserInTx } from "../src/lib/account-provisioning";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
  const disposable =
    process.env.CI === "true" &&
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    url.pathname === "/appliance_desk_test";
  if (!disposable) {
    throw new Error("create-ci-login only runs against CI's disposable test database.");
  }

  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    throw new Error("Usage: tsx scripts/create-ci-login.ts <email> <password>");
  }

  const user = await prisma.$transaction((tx) =>
    createTrustedCredentialUserInTx(tx, {
      email,
      name: "Session fixture",
      role: "CUSTOMER",
      password,
    }),
  );
  process.stdout.write(user.id);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
