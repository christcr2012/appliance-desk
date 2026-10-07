import { resetTwoFactorForRecovery } from "../src/domains/security/two-factor";
import { prisma } from "../src/lib/prisma";

async function main() {
  const args = process.argv.slice(2);
  const emailIndex = args.indexOf("--email");
  const email = emailIndex >= 0 ? args[emailIndex + 1] : undefined;
  const confirmed = args.includes("--confirm");

  if (!email) {
    throw new Error("Usage: npx tsx scripts/reset-two-factor.ts --email <address> --confirm");
  }
  if (!confirmed) {
    throw new Error("Refusing to reset two-step login without the literal --confirm flag.");
  }

  const normalized = await resetTwoFactorForRecovery(email);
  console.log(
    `Two-step login was reset for ${normalized}. The required-role policy will force fresh enrollment on next desk access.`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
