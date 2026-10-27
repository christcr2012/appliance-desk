import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { decryptField } from "@/lib/field-crypto";
import {
  checkW9Pdf,
  createW9Request,
  recordSupplierTin,
  setBackupWithholding,
  submitTypedW9,
  w9LinkState,
} from "@/domains/compliance/w9";

// Disposable CI Postgres only (same gate as the other integration tests).
const url = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return null;
  }
})();
const enabled =
  process.env.CI === "true" &&
  url !== null &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("w9 requests and supplier tax ids", () => {
  const tag = randomUUID().slice(0, 8);
  const supplierId = `cmp3-supplier-${tag}`;
  let ownerId: string;

  beforeAll(async () => {
    process.env.COMPLIANCE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    await prisma.supplier.create({
      data: { id: supplierId, name: `CMP3 W9 supplier ${tag}`, is1099Vendor: true, taxIdOnFile: false },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: supplierId } });
    await prisma.w9Request.deleteMany({ where: { supplierId } });
    await prisma.supplier.deleteMany({ where: { id: supplierId } });
    delete process.env.COMPLIANCE_ENCRYPTION_KEY;
  });

  it("a request link is stored as a hash only, works once, and a fresh link replaces the old one", async () => {
    const first = await createW9Request(ownerId, supplierId);
    const stored = await prisma.w9Request.findFirstOrThrow({ where: { supplierId } });
    expect(stored.tokenHash).not.toBe(first.token);
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const state = await w9LinkState(first.token);
    expect(state.ok).toBe(true);

    // A second request invalidates the first link.
    const second = await createW9Request(ownerId, supplierId);
    expect((await w9LinkState(first.token)).ok).toBe(false);
    expect((await w9LinkState(second.token)).ok).toBe(true);
    expect((await w9LinkState("not-a-real-token")).ok).toBe(false);
  });

  it("concurrent W-9 requests leave exactly one live link (the supplier row is locked)", async () => {
    const [a, b] = await Promise.all([createW9Request(ownerId, supplierId), createW9Request(ownerId, supplierId)]);
    const states = await Promise.all([w9LinkState(a.token), w9LinkState(b.token)]);
    expect(states.filter((s) => s.ok)).toHaveLength(1);
    const live = await prisma.w9Request.count({ where: { supplierId, usedAt: null } });
    expect(live).toBe(1);
  });

  it("a typed submission encrypts the TIN, keeps only the last 4 on the record, and burns the link", async () => {
    const { token } = await createW9Request(ownerId, supplierId);
    await submitTypedW9(token, { legalName: "Sample Services LLC", tinType: "EIN", tin: "12-3456789", address: { street: "100 Main St", city: "Greeley", state: "CO", zip: "80631" } });
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } });
    expect(supplier.legalName).toBe("Sample Services LLC");
    expect(supplier.tinType).toBe("EIN");
    expect(supplier.tinLast4).toBe("6789");
    expect(supplier.taxIdOnFile).toBe(true);
    expect(supplier.w9ReceivedOn).not.toBeNull();
    expect(supplier.tinEncrypted).toBeTruthy();
    expect(supplier.tinEncrypted).not.toContain("123456789");
    expect(supplier.mailingAddress).toBe("100 Main St");
    expect(supplier.mailingCity).toBe("Greeley");
    expect(supplier.mailingState).toBe("CO");
    expect(supplier.mailingZip).toBe("80631");
    expect(decryptField(supplier.tinEncrypted!)).toBe("123456789");
    // The audit trail names fields only — never the number.
    const audits = await prisma.auditLog.findMany({ where: { entityId: supplierId } });
    expect(JSON.stringify(audits)).not.toContain("123456789");

    expect((await w9LinkState(token)).ok).toBe(false);
    await expect(
      submitTypedW9(token, { legalName: "Sample Services LLC", tinType: "EIN", tin: "12-3456789", address: { street: "100 Main St", city: "Greeley", state: "CO", zip: "80631" } }),
    ).rejects.toThrow(/no longer active|already been used/);
  });

  it("rejects a tax ID that is not 9 digits", async () => {
    const { token } = await createW9Request(ownerId, supplierId);
    await expect(
      submitTypedW9(token, { legalName: "Sample Services LLC", tinType: "EIN", tin: "12345", address: { street: "100 Main St", city: "Greeley", state: "CO", zip: "80631" } }),
    ).rejects.toThrow(/9 digits/);
  });

  it("a typed submission can carry the filled W-9's stored file", async () => {
    const { token } = await createW9Request(ownerId, supplierId);
    await submitTypedW9(token, {
      legalName: "Sample Services LLC",
      tinType: "EIN",
      tin: "12-3456789",
      w9FileUrl: "https://store.example/compliance/w9/filled.pdf",
      address: { street: "100 Main St", city: "Greeley", state: "CO", zip: "80631" },
    });
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } });
    expect(supplier.w9FileUrl).toBe("https://store.example/compliance/w9/filled.pdf");
  });

  it("the owner can record a paper W-9 and toggle backup withholding", async () => {
    await setBackupWithholding(ownerId, supplierId, true);
    expect((await prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } })).backupWithholding).toBe(true);
    await recordSupplierTin(ownerId, supplierId, {
      legalName: "Paper Name LLC",
      tinType: "EIN",
      tin: "987654321",
      backupWithholding: false,
      address: { street: "22 Paper Rd", city: "Evans", state: "co", zip: "80620" },
    });
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } });
    expect(supplier.legalName).toBe("Paper Name LLC");
    expect(supplier.tinLast4).toBe("4321");
    expect(supplier.mailingAddress).toBe("22 Paper Rd");
    expect(supplier.mailingState).toBe("CO");
    expect(supplier.backupWithholding).toBe(false);
  });

  it("an uploaded W-9 must be a real PDF of at most 4 MB", () => {
    expect(() => checkW9Pdf(new Uint8Array(0))).toThrow(/empty/);
    expect(() => checkW9Pdf(new TextEncoder().encode("not a pdf at all"))).toThrow(/not a PDF/);
    expect(() => checkW9Pdf(new TextEncoder().encode("%PDF-1.7 sample"))).not.toThrow();
    const big = new Uint8Array(4 * 1024 * 1024 + 1);
    big.set(new TextEncoder().encode("%PDF-"));
    expect(() => checkW9Pdf(big)).toThrow(/4 MB/);
  });
});
