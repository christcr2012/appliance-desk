// Negative verification only for GitHub CI's disposable Postgres. Never run
// against preview or production; all DDL below rolls back in a transaction.
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { verifySchemaHealth } from "../src/lib/schema-health";

async function main() {
  const target = new URL(process.env.DATABASE_URL ?? "");
  assert(process.env.CI === "true" && target.hostname === "localhost" &&
    target.pathname === "/appliance_desk_test",
  "Schema health negative test requires CI's disposable localhost database.");

  let missingColumnRejected = false;
  try {
    await prisma.$transaction(async (tx) => {
      // StaffTask was absent from the old representative-table check. It is
      // still empty here (before seed), proving empty tables are validated.
      assert.equal(await tx.staffTask.count(), 0);
      await tx.$executeRaw`ALTER TABLE "StaffTask" DROP COLUMN "note"`;
      await verifySchemaHealth(tx);
      // Force rollback even if the check unexpectedly succeeds.
      throw new Error("Schema health accepted a missing column.");
    }, { timeout: 30_000 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("failed for StaffTask") &&
      error.cause instanceof Prisma.PrismaClientKnownRequestError && error.cause.code === "P2022") {
      missingColumnRejected = true;
    } else {
      throw error;
    }
  }
  assert(missingColumnRejected, "Schema health must reject a missing column.");
  // The same checks must pass again after the transaction rolls back.
  await verifySchemaHealth(prisma);
  console.log("[schema-health-test] Missing column rejected; rollback verified.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
