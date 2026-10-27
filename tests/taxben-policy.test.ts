import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import {
  capitalizationPolicyText,
  getPolicyState,
  listPolicyAttention,
  policyTemplateKey,
  previewCapitalizationPolicy,
  signCapitalizationPolicy,
} from "@/domains/taxben/policy";

// TAXBEN-1 section 1: the written capitalization policy — generated from
// the rule book, signed by the owner on screen, stored as a business
// record, and renewed each December via the Today list.

describe("capitalizationPolicyText", () => {
  it("names the business, the rule-book limit and the year, with a signature block", () => {
    const text = capitalizationPolicyText({
      businessName: "Robinson Appliance Rentals",
      year: 2027,
      limitCents: 250_000,
      bonusPercent: 100,
      bonusAcquiredAfter: "2025-01-19",
      preferSection179: false,
      signerName: "Chris Robinson",
      signedOnKey: "2026-12-15",
    });
    expect(text).toContain("Capitalization policy — Robinson Appliance Rentals");
    expect(text).toContain("at or under $2,500.00");
    expect(text).toContain("For the 2027 tax year");
    expect(text).toContain("100% bonus depreciation");
    expect(text).toContain("Signed: Chris Robinson — 2026-12-15");
  });

  it("uses the Section 179 wording when the CPA preference says so", () => {
    const text = capitalizationPolicyText({
      businessName: "Robinson Appliance Rentals",
      year: 2027,
      limitCents: 250_000,
      bonusPercent: 100,
      bonusAcquiredAfter: "2025-01-19",
      preferSection179: true,
      signerName: null,
      signedOnKey: null,
    });
    expect(text).toContain("Section 179 expensing");
    expect(text).not.toContain("Signed:");
  });
});

// ---------------------------------------------------------------------------
// Signing and attention (real Postgres; the signed record is cleaned up)
// ---------------------------------------------------------------------------

const url = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return new URL("http://localhost/");
  }
})();
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("capitalization policy signing (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `taxben-policy-owner-${tag}`;
  const SIGN_YEAR = 2027;

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: ownerId, action: "taxben.policy_signed" } });
    await prisma.businessPaperwork.deleteMany({ where: { templateKey: policyTemplateKey(SIGN_YEAR) } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  it("shows the unsigned years on the attention list, December adding next year", async () => {
    const october = await listPolicyAttention(businessDateFromKey("2026-10-15")!);
    expect(october.map((item) => item.year)).toContain(2026);
    expect(october.every((item) => !item.renewal || item.year === 2027)).toBe(true);
    const december = await listPolicyAttention(businessDateFromKey("2026-12-10")!);
    expect(december.map((item) => item.year)).toContain(2027);
    expect(december.find((item) => item.year === 2027)?.renewal).toBe(true);
  });

  it("previews the policy with the seeded limit before signing", async () => {
    const text = await previewCapitalizationPolicy(prisma, SIGN_YEAR);
    expect(text).toContain("at or under $2,500.00");
    const state = await getPolicyState(prisma, SIGN_YEAR);
    expect(state.status).toBe("MISSING");
  });

  it("signs once, stores the document as a business record, and audits it", async () => {
    await prisma.user.create({
      data: { id: ownerId, email: `taxben-policy-${tag}@example.test`, name: "Test Owner", role: "OWNER" },
    });
    const signed = await signCapitalizationPolicy(ownerId, SIGN_YEAR, businessDateFromKey("2026-12-15")!);
    expect(signed.status).toBe("SIGNED");
    expect(signed.signedOn).toBe("2026-12-15");
    const record = await prisma.businessPaperwork.findUniqueOrThrow({
      where: { templateKey: policyTemplateKey(SIGN_YEAR) },
    });
    expect(record.status).toBe("DONE");
    expect(record.kind).toBe("DOCUMENT");
    expect(record.notes).toContain("at or under $2,500.00");
    expect(record.notes).toContain("Signed: Test Owner — 2026-12-15");
    // Signing again changes nothing and adds no second audit row.
    const again = await signCapitalizationPolicy(ownerId, SIGN_YEAR, businessDateFromKey("2026-12-20")!);
    expect(again.recordId).toBe(signed.recordId);
    const audits = await prisma.auditLog.findMany({
      where: { userId: ownerId, action: "taxben.policy_signed" },
    });
    expect(audits).toHaveLength(1);
    // December attention no longer asks for the signed year.
    const december = await listPolicyAttention(businessDateFromKey("2026-12-21")!);
    expect(december.map((item) => item.year)).not.toContain(SIGN_YEAR);
  });

  it("refuses a non-owner signer", async () => {
    const staffId = `taxben-policy-staff-${tag}`;
    await prisma.user.create({
      data: { id: staffId, email: `taxben-policy-staff-${tag}@example.test`, role: "STAFF" },
    });
    try {
      await expect(
        signCapitalizationPolicy(staffId, SIGN_YEAR + 1, businessDateFromKey("2026-12-15")!),
      ).rejects.toThrow();
    } finally {
      await prisma.user.deleteMany({ where: { id: staffId } });
    }
  });
});
