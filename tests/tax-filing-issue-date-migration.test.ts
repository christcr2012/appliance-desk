import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";

const sql = readFileSync(
  "prisma/migrations/20261010130000_batch_t_invoice_issued_at/migration.sql", "utf8",
);
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe("T-6b1 invoice issue-date evidence upgrade", () => {
  it("is additive and backfills only non-void local invoices, never historical Stripe issue dates", () => {
    expect(sql).toContain('ADD COLUMN "issuedAt"');
    expect(sql).toContain('"stripeInvoiceId" IS NULL');
    expect(sql).toContain("'DRAFT'");
    expect(sql).toContain("'VOID'");
    expect(sql).not.toMatch(/DROP COLUMN|DROP TABLE|TRUNCATE/i);
  });
  it.skipIf(!enabled)("has a real queryable issuedAt column and index", async () => {
    const columns = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT column_name AS name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Invoice' AND column_name = 'issuedAt'
    `;
    expect(columns).toEqual([{ name: "issuedAt" }]);
    const indexes = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT indexname AS name FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'Invoice'
        AND indexname = 'Invoice_issuedAt_idx'
    `;
    expect(indexes).toHaveLength(1);
  });
});
