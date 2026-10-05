import { describe, it, expect, vi, beforeEach } from "vitest";

// Real gap fixed 2026-09-27 (found by a code review, see
// docs/DECISIONS.md): signAgreement used to update the SignatureRecord
// unconditionally once getSignatureRecordForSigning's initial read said
// it wasn't signed yet — two overlapping requests for the same signing
// link (a double-click, a retried submit) could both pass that read and
// both proceed. The actual write is now an atomic conditional updateMany
// requiring signedAt still be null, same pattern as appliance
// reservations (tests/agreements-reservation.test.ts).

const signatureRecordUpdateMany = vi.fn();
const rentalAgreementUpdate = vi.fn();
const rentalLineFindMany = vi.fn();
const auditLogCreate = vi.fn();

function makeTx() {
  return {
    // Signing locks the agreement row (FOR UPDATE) and re-reads its status
    // inside the transaction before the conditional signature update.
    $queryRaw: async () => [{ id: "agr-1" }],
    signatureRecord: { updateMany: signatureRecordUpdateMany },
    rentalAgreement: {
      findUniqueOrThrow: async () => ({ id: "agr-1", status: "AWAITING_SIGNATURE" }),
      update: rentalAgreementUpdate,
    },
    rentalLine: { findMany: rentalLineFindMany },
    auditLog: { create: auditLogCreate },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    signatureRecord: {
      findUnique: vi.fn().mockResolvedValue({
        id: "sig-1",
        signedAt: null,
        agreementId: "agr-1",
        agreement: { status: "AWAITING_SIGNATURE" },
      }),
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(makeTx()),
  },
}));

vi.mock("@/domains/documents/artifacts", () => ({ createSignedAgreementArtifactInTx: vi.fn().mockResolvedValue("artifact-1") }));

describe("signAgreement — atomic conditional update", () => {
  beforeEach(() => {
    signatureRecordUpdateMany.mockReset();
    rentalAgreementUpdate.mockReset().mockResolvedValue({});
    rentalLineFindMany.mockReset().mockResolvedValue([]);
    auditLogCreate.mockReset().mockResolvedValue({});
  });

  it("signs via a conditional updateMany requiring signedAt still be null, not a plain update", async () => {
    signatureRecordUpdateMany.mockResolvedValue({ count: 1 });
    const { signAgreement } = await import("@/domains/agreements");

    await signAgreement("sig-1", {
      signerName: "Jane Doe",
      signerEmail: "jane@example.test",
      ipAddress: "1.2.3.4",
    });

    expect(signatureRecordUpdateMany).toHaveBeenCalledWith({
      where: { id: "sig-1", agreementId: "agr-1", signedAt: null },
      data: expect.objectContaining({ signerName: "Jane Doe" }),
    });
    expect(rentalAgreementUpdate).toHaveBeenCalled();
  });

  it("aborts — and never activates the agreement — when the conditional update loses the race (count 0)", async () => {
    signatureRecordUpdateMany.mockResolvedValue({ count: 0 });
    const { signAgreement } = await import("@/domains/agreements");

    await expect(
      signAgreement("sig-1", {
        signerName: "Jane Doe",
        signerEmail: "jane@example.test",
        ipAddress: "1.2.3.4",
      }),
    ).rejects.toThrow(/already signed/);

    expect(rentalAgreementUpdate).not.toHaveBeenCalled();
    expect(auditLogCreate).not.toHaveBeenCalled();
  });
});
