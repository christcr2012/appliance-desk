import { describe, it, expect, vi, beforeEach } from "vitest";

// sendEstimate tells the caller whether an email really went out, so the owner
// is told to share the link by hand when customer email is switched off.

const estimateFindUniqueOrThrow = vi.fn();
const transaction = vi.fn();
const tx = {
  $queryRaw: vi.fn(),
  estimate: {
    findUniqueOrThrow: (...a: unknown[]) => estimateFindUniqueOrThrow(...a),
    update: vi.fn(),
  },
  auditLog: { create: vi.fn() },
};
const deliverMessage = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    estimate: {
      findUniqueOrThrow: (...a: unknown[]) => estimateFindUniqueOrThrow(...a),
      update: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));
vi.mock("@/domains/messaging/deliver", () => ({
  deliverMessage: (...a: unknown[]) => deliverMessage(...a),
}));
vi.mock("@/domains/estimates/preapproval-quote", () => ({
  getPreparedEstimateQuoteInTx: vi.fn().mockResolvedValue({
    status: "REVIEW_REQUIRED", reasons: ["No frozen reviewed charge."],
    quoteFingerprint: null, orderFingerprint: null,
  }),
}));
vi.mock("@/domains/settings", () => ({
  getBusinessSettings: vi.fn().mockResolvedValue({
    publicBusinessName: "Robinson Appliance Rentals",
  }),
}));

// Synthetic reviewed-catalog boundary only. The real review/source gate has
// separate W-26 runtime and browser tests; no provider or approval is activated.
vi.mock("@/domains/language/review",()=>({displayCustomerLanguage:async(preference:"en"|"es")=>preference}));
vi.mock("@/domains/language/runtime",async()=>{
 const {TRANSACTIONAL_COPY}=await import("@/domains/language/transactional-copy");
 return {activeMessageCatalog:async(language:"en"|"es")=>TRANSACTIONAL_COPY[language]};
});

import { sendEstimate } from "@/domains/estimates";

describe("sendEstimate and the customer email switch", () => {
  beforeEach(() => {
    tx.$queryRaw.mockReset().mockResolvedValue([{ id: "est-1" }]);
    transaction
      .mockReset()
      .mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    deliverMessage.mockReset();
    estimateFindUniqueOrThrow.mockReset().mockResolvedValue({
      id: "est-1",
      estimateNumber: 7,
      title: null,
      clientMessage: null,
      status: "DRAFT",
      lineItems: [
        {
          monthlyPriceCents: 3000,
          oneTimePriceCents: 0,
          quantity: 1,
          billingType: "MONTHLY",
        },
      ],
      customer: {
        user: { name: "Jane", email: "jane@example.com" },
      },
      lead: null,
    });
  });

  it.each(["ACCEPTED","UNKNOWN"])("uses the saved quote language and preserves provider outcome %s",async state=>{
    const estimate=await estimateFindUniqueOrThrow();
    estimateFindUniqueOrThrow.mockResolvedValue({...estimate,preferredLanguage:"es"});
    deliverMessage.mockResolvedValue({state,deliveryId:"synthetic-language-delivery",providerMessageId:state==="ACCEPTED"?"synthetic-email":null});
    expect(await sendEstimate("u1","est-1")).toEqual({emailed:state==="ACCEPTED",outcome:state==="ACCEPTED"?"SENT":"UNKNOWN"});
    const call=deliverMessage.mock.calls[0][0];const copy=call.render();
    expect(call.recipient.address).toBe("jane@example.com");
    expect(call.idempotencyKey).toMatch(/^estimate-send-est-1-/);
    expect(copy.subject).toContain("Presupuesto");expect(copy.text).toContain("$30.00");
    expect(copy.text).toContain("/estimate/est-1");expect(copy.text).toContain("No puede aceptar ni pagar");
  });
  it("reports emailed: true when the provider accepted the email", async () => {
    deliverMessage.mockResolvedValue({
      state: "ACCEPTED",
      deliveryId: "delivery-1",
      providerMessageId: "email-1",
    });
    expect(await sendEstimate("u1", "est-1")).toEqual({
      emailed: true,
      outcome: "SENT",
    });
  });

  it("reports emailed: false (estimate still marked sent) when customer email is off", async () => {
    deliverMessage.mockResolvedValue({
      state: "NOT_SENT",
      deliveryId: "delivery-2",
      providerMessageId: null,
    });
    expect(await sendEstimate("u1", "est-1")).toEqual({
      emailed: false,
      outcome: "NOT_ATTEMPTED",
    });
    expect(transaction).toHaveBeenCalled();
  });
});
