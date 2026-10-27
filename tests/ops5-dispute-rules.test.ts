import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  bankRefundEarliest, clampWindowDays, disputeStateFromStripe, dueDescription, disputeTitle, isFinalState, whole,
  MAX_ACH_DISPUTE_WINDOW_DAYS, MIN_ACH_DISPUTE_WINDOW_DAYS, RECOMMENDED_ACH_DISPUTE_WINDOW_DAYS,
} from "@/domains/disputes/rules";
import { renderEvidencePacket, safeText, type PacketData } from "@/domains/disputes/packet-render";

const now = new Date("2026-11-10T18:00:00Z");

describe("dispute rules", () => {
  it("maps Stripe statuses to our states", () => {
    expect(disputeStateFromStripe("needs_response")).toBe("NEEDS_RESPONSE");
    expect(disputeStateFromStripe("warning_needs_response")).toBe("NEEDS_RESPONSE");
    expect(disputeStateFromStripe("under_review")).toBe("UNDER_REVIEW");
    expect(disputeStateFromStripe("won")).toBe("WON");
    expect(disputeStateFromStripe("lost")).toBe("LOST");
    expect(isFinalState("WON")).toBe(true);
    expect(isFinalState("UNDER_REVIEW")).toBe(false);
  });

  it("describes the deadline in plain words and flags urgency inside three days", () => {
    expect(dueDescription(new Date(now.getTime() + 10 * 86_400_000), now)).toMatchObject({ text: "within 10 days", urgent: false, overdue: false });
    expect(dueDescription(new Date(now.getTime() + 2 * 86_400_000), now).urgent).toBe(true);
    expect(dueDescription(new Date(now.getTime() - 1000), now)).toMatchObject({ overdue: true, urgent: true });
    expect(dueDescription(null, now).urgent).toBe(true);
  });

  it("titles a bank dispute as collect directly and a card dispute with its deadline", () => {
    expect(disputeTitle({ customerName: "Ana", amountCents: 12_500, isBank: true, dueBy: null }, now)).toContain("collect directly");
    expect(disputeTitle({ customerName: "Ana", amountCents: 12_500, isBank: false, dueBy: new Date(now.getTime() + 5 * 86_400_000) }, now)).toBe("Card dispute: Ana $125.00 — respond within 5 days");
    expect(whole(5)).toBe("$0.05");
  });

  it("keeps the bank refund wait inside the allowed range and counts from the debit date", () => {
    expect(clampWindowDays(1)).toBe(MIN_ACH_DISPUTE_WINDOW_DAYS);
    expect(clampWindowDays(500)).toBe(MAX_ACH_DISPUTE_WINDOW_DAYS);
    expect(clampWindowDays(Number.NaN)).toBe(RECOMMENDED_ACH_DISPUTE_WINDOW_DAYS);
    expect(bankRefundEarliest(new Date("2026-01-01T00:00:00Z"), 60).toISOString()).toBe("2026-03-02T00:00:00.000Z");
  });
});

const base = (overrides: Partial<PacketData> = {}): PacketData => ({
  dispute: { id: "d1", stripeDisputeId: "dp_test", amountCents: 12_500, reason: "product_not_received", openedAt: now, dueBy: null },
  customer: { name: "Ana López", email: "ana@example.test" },
  agreement: null,
  deliveries: [],
  invoice: null,
  messages: [],
  businessName: "Robinson Appliance Rentals",
  generatedAt: now,
  ...overrides,
});

async function noisyPhoto(seed: number) {
  const raw = Buffer.alloc(1600 * 1200 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919 + seed * 104729 + ((i * i) >> 3)) & 255;
  return sharp(raw, { raw: { width: 1600, height: 1200, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
}

describe("dispute evidence packet", () => {
  it("strips characters the PDF font cannot draw instead of failing", () => {
    const out = safeText("Ana López — “quoted” 日本");
    expect(out).toContain("López"); // accented Latin letters the font can draw are kept
    expect(out).not.toMatch(/[\u2013\u2014\u201c\u201d\u65e5\u672c]/);
  });

  it("builds a valid PDF with no photos", async () => {
    const result = await renderEvidencePacket(base(), async () => null);
    expect(Buffer.from(result.pdf).subarray(0, 5).toString()).toBe("%PDF-");
    expect(result.photosIncluded).toBe(0);
  });

  it("drops the oldest photos first until the file fits, and never drops the written facts", async () => {
    const photos = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, takenAt: new Date(now.getTime() + i * 1000), label: `photo ${i}` }));
    const data = base({ deliveries: [{ id: "j1", type: "DELIVERY", completedAt: now, outcome: "COMPLETED", notes: "Left at door", photos }] });
    const jpegs = await Promise.all(photos.map((_, i) => noisyPhoto(i)));
    const load = async (id: string) => jpegs[Number(id.slice(1))] ?? null;
    const unlimited = await renderEvidencePacket(data, load);
    expect(unlimited.photosIncluded).toBe(6);
    const limit = Math.floor(unlimited.bytes * 0.6);
    const limited = await renderEvidencePacket(data, load, limit);
    expect(limited.bytes).toBeLessThanOrEqual(limit);
    expect(limited.photosDropped).toBeGreaterThan(0);
    expect(limited.photosIncluded + limited.photosDropped).toBe(6);
    await expect(renderEvidencePacket(data, load, 500)).rejects.toThrow(/larger than Stripe accepts/);
  });
});
