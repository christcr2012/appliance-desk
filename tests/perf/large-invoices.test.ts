import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getInvoicesCount, getInvoicesPage } from "@/domains/billing";
import { prisma } from "@/lib/prisma";
import {
  createLargeInvoiceFixture,
  enforceRecordedBaseline,
  LARGE_INVOICE_COUNT,
  measuredMedian,
  PERF_ENABLED,
  type LargeInvoiceFixture,
} from "./fixtures";

describe.skipIf(!PERF_ENABLED)("Batch F 5,000-invoice billing list (isolated CI Postgres)", () => {
  let fixture: LargeInvoiceFixture;

  beforeAll(async () => {
    fixture = await createLargeInvoiceFixture();
  }, 60_000);

  afterAll(async () => {
    if (fixture) await fixture.cleanup();
  }, 30_000);

  it("has the matching newest-first compound index after a real migration", async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'Invoice'
        AND indexname = 'Invoice_createdAt_id_idx'
    `;
    expect(indexes).toHaveLength(1);
    expect(indexes[0]!.indexdef).toContain('"createdAt" DESC');
    expect(indexes[0]!.indexdef).toMatch(/\bid DESC\b/);
  });

  it("keeps the real billing count + first page bounded within baseline", async () => {
    const result = await measuredMedian("f-large-invoices-billing-page", async () =>
      Promise.all([
        getInvoicesCount(),
        getInvoicesPage(undefined, 0, 50),
      ]),
    );
    const [count, page] = result.value;

    expect(count).toBeGreaterThanOrEqual(LARGE_INVOICE_COUNT);
    expect(page).toHaveLength(50);
    enforceRecordedBaseline("f-large-invoices-billing-page", result.ms);
  });
});
