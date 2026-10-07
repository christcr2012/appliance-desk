import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getInvoicesCount, getInvoicesPage } from "@/domains/billing";
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
