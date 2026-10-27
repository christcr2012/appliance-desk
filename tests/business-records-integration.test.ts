import { createHash, randomBytes, randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// VAULT-1 on real disposable Postgres: encrypted numbers and their masking,
// the OWNER/ADMIN boundary, starter idempotency, file attach/verify rules,
// renewal keeping history, the To do surfacing, and the masked export pack.
// Blob storage is an in-memory stand-in (the privacy store is not reachable
// from tests); everything else — database, encryption, zip — is real.
const m = vi.hoisted(() => ({
  blobs: new Map<string, Uint8Array>(),
  store: { token: "test-token", storeId: "store_test" } as { token: string; storeId: string } | null,
}));
vi.mock("@vercel/blob", () => ({
  put: async (pathname: string, body: Buffer | Uint8Array) => {
    m.blobs.set(pathname, new Uint8Array(body as Uint8Array));
    return { url: `https://store.example/${pathname}`, pathname };
  },
  get: async (pathname: string) => {
    const bytes = m.blobs.get(pathname);
    if (!bytes) return { statusCode: 404, stream: null, blob: { contentType: "", size: 0 } };
    return {
      statusCode: 200,
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      blob: { contentType: "application/pdf", size: bytes.length },
    };
  },
  del: async () => undefined,
  list: async () => ({ blobs: [], hasMore: false }),
}));
vi.mock("@/lib/photo-storage", async (original) => ({
  ...(await original<typeof import("@/lib/photo-storage")>()),
  getPrivatePhotoStore: () => m.store,
}));

import { prisma } from "@/lib/prisma";
import { decryptField } from "@/lib/field-crypto";
import {
  addStarterChecklist,
  createPaperwork,
  deletePaperwork,
  listPaperworkAttention,
} from "@/domains/paperwork";
import type { PaperworkInput } from "@/domains/paperwork/schema";
import {
  archiveRecord,
  attachRecordFile,
  buildExportPack,
  clearRecordNumber,
  getRecord,
  listRecords,
  registerUploadedRecordFile,
  removeRecordFile,
  renewRecord,
  updatePaperworkAdminKinds,
  recommendedAdminKinds,
} from "@/domains/paperwork/records";
import { canUploadPhoto } from "@/domains/uploads";

let enabled = false;
try {
  const target = new URL(process.env.DATABASE_URL ?? "");
  enabled =
    process.env.CI === "true" &&
    !process.env.VERCEL &&
    ["localhost", "127.0.0.1"].includes(target.hostname) &&
    target.pathname === "/appliance_desk_test";
} catch {
  enabled = false;
}

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nvault test document\n");
const TEXT_BYTES = new TextEncoder().encode("definitely not a pdf");

function unzipAll(zip: Uint8Array): { name: string; data: Uint8Array }[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const out: { name: string; data: Uint8Array }[] = [];
  let offset = 0;
  while (offset + 30 <= zip.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(zip.subarray(offset + 30, offset + 30 + nameLength));
    const payload = zip.subarray(
      offset + 30 + nameLength + extraLength,
      offset + 30 + nameLength + extraLength + compressedSize,
    );
    out.push({ name, data: method === 8 ? new Uint8Array(inflateRawSync(payload)) : payload });
    offset += 30 + nameLength + extraLength + compressedSize;
  }
  return out;
}

describe.skipIf(!enabled)("VAULT-1 business records (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 12);
  const ownerId = `vault-owner-${tag}`;
  const adminId = `vault-admin-${tag}`;
  const staffId = `vault-staff-${tag}`;
  const createdRecordIds: string[] = [];

  const input = (overrides: Partial<PaperworkInput> = {}): PaperworkInput =>
    ({
      title: `Vault test record ${tag}`,
      groupName: "Taxes",
      status: "TO_DO",
      whatItIs: null,
      agency: null,
      officialUrl: null,
      referenceNumber: null,
      startedOn: null,
      dueOn: null,
      remindDaysBefore: 30,
      repeatEveryMonths: null,
      notes: null,
      kind: "DOCUMENT",
      issuedOn: null,
      expiresOn: null,
      numberLabel: null,
      numberValue: null,
      portalUrl: null,
      costDollars: null,
      linkedObligationKeys: [],
      ...overrides,
    }) as PaperworkInput;

  beforeAll(async () => {
    process.env.COMPLIANCE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${ownerId}@example.test`, name: "Owner", role: "OWNER" },
        { id: adminId, email: `${adminId}@example.test`, name: "Admin", role: "ADMIN" },
        { id: staffId, email: `${staffId}@example.test`, name: "Staff", role: "STAFF" },
      ],
    });
    await prisma.businessSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", paperworkAdminKinds: recommendedAdminKinds() },
      update: { paperworkAdminKinds: recommendedAdminKinds() },
    });
  });

  afterAll(async () => {
    await prisma.businessRecordFile.deleteMany({ where: { recordId: { in: createdRecordIds } } });
    await prisma.businessPaperwork.deleteMany({ where: { id: { in: createdRecordIds } } });
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { paperworkAdminKinds: recommendedAdminKinds() },
    });
    delete process.env.COMPLIANCE_ENCRYPTION_KEY;
  });

  it("adds the starter records once — adding them again changes nothing", async () => {
    const before = await prisma.businessPaperwork.count({ where: { templateKey: { not: null } } });
    const first = await addStarterChecklist(ownerId);
    const second = await addStarterChecklist(ownerId);
    const after = await prisma.businessPaperwork.count({ where: { templateKey: { not: null } } });
    expect(first.added).toBeGreaterThan(0);
    expect(second.added).toBe(0);
    expect(after).toBe(before + first.added);
    const ein = await prisma.businessPaperwork.findUnique({ where: { templateKey: "ein" } });
    expect(ein?.kind).toBe("TAX_ACCOUNT");
    expect(ein?.numberLabel).toBe("EIN");
    const iris = await prisma.businessPaperwork.findUnique({ where: { templateKey: "iris-tcc" } });
    expect(iris?.linkedObligationKeys).toContain("fed.1099_nec");
    const all = await prisma.businessPaperwork.findMany({ where: { templateKey: { not: null } }, select: { id: true } });
    createdRecordIds.push(...all.map((r) => r.id));
  });

  it("stores the number encrypted, shows only the last four, and keeps it from admins", async () => {
    const id = await createPaperwork(
      ownerId,
      input({ kind: "TAX_ACCOUNT", numberLabel: "EIN", numberValue: "98-7654321", title: `EIN record ${tag}` }),
    );
    createdRecordIds.push(id);
    const row = await prisma.businessPaperwork.findUniqueOrThrow({ where: { id } });
    expect(row.numberEncrypted).toBeTruthy();
    expect(row.numberEncrypted).not.toContain("98-7654321");
    expect(decryptField(row.numberEncrypted!)).toBe("98-7654321");
    expect(row.numberLast4).toBe("4321");

    const ownerView = await getRecord("OWNER", id);
    expect(ownerView?.hasNumber).toBe(true);
    expect(ownerView?.numberLast4).toBe("4321");
    expect(ownerView).not.toHaveProperty("numberEncrypted");
    // TAX_ACCOUNT is not an admin kind, and the record holds a number besides.
    expect(await getRecord("ADMIN", id)).toBeNull();
    expect(await getRecord("STAFF", id)).toBeNull();
    expect(await getRecord("CUSTOMER", id)).toBeNull();
  });

  it("lets an admin read a number-free record of an allowed kind — until a number is added", async () => {
    const id = await createPaperwork(
      ownerId,
      input({ kind: "DOCUMENT", title: `Articles ${tag}`, referenceNumber: "CASE-123" }),
    );
    createdRecordIds.push(id);
    const adminView = await getRecord("ADMIN", id);
    expect(adminView?.title).toContain("Articles");
    expect(adminView?.referenceNumber).toBeNull(); // owner-only text never reaches the admin DTO
    const adminList = await listRecords("ADMIN");
    expect(adminList.some((r) => r.id === id)).toBe(true);

    const { updatePaperwork } = await import("@/domains/paperwork");
    const current = await prisma.businessPaperwork.findUniqueOrThrow({ where: { id } });
    await updatePaperwork(ownerId, id, input({ kind: "DOCUMENT", title: `Articles ${tag}`, numberValue: "55-1212123" }), current.version);
    expect(await getRecord("ADMIN", id)).toBeNull();

    await clearRecordNumber(ownerId, id);
    const cleared = await getRecord("OWNER", id);
    expect(cleared?.hasNumber).toBe(false);
    expect(await getRecord("ADMIN", id)).not.toBeNull();
  });

  it("refuses to store a number when the encryption key is not set", async () => {
    const saved = process.env.COMPLIANCE_ENCRYPTION_KEY;
    delete process.env.COMPLIANCE_ENCRYPTION_KEY;
    try {
      await expect(
        createPaperwork(ownerId, input({ numberValue: "12-3456789" })),
      ).rejects.toThrow(/encryption key isn't set/);
    } finally {
      process.env.COMPLIANCE_ENCRYPTION_KEY = saved;
    }
  });

  it("attaches files by their real bytes, keeps removed files as history, and blocks delete while files exist", async () => {
    const id = await createPaperwork(ownerId, input({ title: `Filed doc ${tag}` }));
    createdRecordIds.push(id);
    await expect(
      attachRecordFile(ownerId, id, { fileName: "sneaky.pdf", bytes: TEXT_BYTES }),
    ).rejects.toThrow(/isn't a PDF or a photo/);
    const fileId = await attachRecordFile(ownerId, id, { fileName: "letter.pdf", bytes: PDF_BYTES, label: "CP 575" });
    const fileRow = await prisma.businessRecordFile.findUniqueOrThrow({ where: { id: fileId } });
    expect(fileRow.pathname).toBe(`records/${id}/${fileId}.pdf`);
    expect(fileRow.sha256).toBe(createHash("sha256").update(PDF_BYTES).digest("hex"));
    expect((await getRecord("OWNER", id))?.files).toHaveLength(1);

    await expect(deletePaperwork(ownerId, id)).rejects.toThrow(/has files attached/);
    await removeRecordFile(ownerId, id, fileId);
    expect((await getRecord("OWNER", id))?.files).toHaveLength(0);
    const historyRow = await prisma.businessRecordFile.findUniqueOrThrow({ where: { id: fileId } });
    expect(historyRow.deletedAt).not.toBeNull();
  });

  it("registers a large PDF uploaded straight to the store, after verifying its bytes", async () => {
    const id = await createPaperwork(ownerId, input({ title: `Big scan ${tag}` }));
    createdRecordIds.push(id);
    m.blobs.set(`records/${id}/big-scan.pdf`, PDF_BYTES);
    const fileId = await registerUploadedRecordFile(ownerId, id, {
      pathname: `records/${id}/big-scan.pdf`,
      fileName: "big-scan.pdf",
    });
    expect(fileId).toBeTruthy();
    m.blobs.set(`records/${id}/not-a-pdf.pdf`, TEXT_BYTES);
    await expect(
      registerUploadedRecordFile(ownerId, id, { pathname: `records/${id}/not-a-pdf.pdf`, fileName: "not-a-pdf.pdf" }),
    ).rejects.toThrow(/Only PDF files/);
    await expect(
      registerUploadedRecordFile(ownerId, id, { pathname: `records/other-record/x.pdf`, fileName: "x.pdf" }),
    ).rejects.toThrow(/doesn't belong to this record/);
  });

  it("renews with an explicit date or by the repeat length, keeping the files", async () => {
    const id = await createPaperwork(
      ownerId,
      input({ title: `License ${tag}`, kind: "LICENSE", expiresOn: "2026-06-30", repeatEveryMonths: 12, status: "IN_PROGRESS" }),
    );
    createdRecordIds.push(id);
    await attachRecordFile(ownerId, id, { fileName: "license.pdf", bytes: PDF_BYTES });
    const v1 = (await prisma.businessPaperwork.findUniqueOrThrow({ where: { id } })).version;
    await renewRecord(ownerId, id, { expectedVersion: v1 }, new Date("2026-10-26T12:00:00Z"));
    let row = await prisma.businessPaperwork.findUniqueOrThrow({ where: { id } });
    expect(row.expiresOn?.toISOString().slice(0, 10)).toBe("2027-06-30");
    expect(row.status).toBe("DONE");
    expect((await getRecord("OWNER", id))?.files).toHaveLength(1);
    await renewRecord(ownerId, id, { expectedVersion: row.version, expiresOn: "2028-01-15" });
    row = await prisma.businessPaperwork.findUniqueOrThrow({ where: { id } });
    expect(row.expiresOn?.toISOString().slice(0, 10)).toBe("2028-01-15");
  });

  it("surfaces an expiring record on the To do list from its expiry, and archiving silences it", async () => {
    const now = new Date();
    const in10 = new Date(now.getTime() + 10 * 24 * 3600 * 1000);
    const in90 = new Date(now.getTime() + 90 * 24 * 3600 * 1000);
    const key = (d: Date) => d.toISOString().slice(0, 10);
    const id = await createPaperwork(
      ownerId,
      input({ title: `Expiring ${tag}`, kind: "LICENSE", expiresOn: key(in10), dueOn: key(in90) }),
    );
    createdRecordIds.push(id);
    const attention = await listPaperworkAttention(new Date());
    const mine = attention.find((a) => a.href === `/desk/paperwork/${id}`);
    expect(mine).toBeTruthy();
    expect(mine?.dueOn?.toISOString().slice(0, 10)).toBe(key(in10));
    const row = await prisma.businessPaperwork.findUniqueOrThrow({ where: { id } });
    await archiveRecord(ownerId, id, row.version);
    const after = await listPaperworkAttention(new Date());
    expect(after.some((a) => a.href === `/desk/paperwork/${id}`)).toBe(false);
  });

  it("exports a masked pack: files inside, the full number nowhere, and an audit row", async () => {
    const id = await createPaperwork(
      ownerId,
      input({ kind: "TAX_ACCOUNT", numberLabel: "EIN", numberValue: "98-7654321", title: `Export me ${tag}` }),
    );
    createdRecordIds.push(id);
    await attachRecordFile(ownerId, id, { fileName: "ein-letter.pdf", bytes: PDF_BYTES });
    const pack = await buildExportPack(ownerId, [id]);
    expect(new TextDecoder().decode(pack.bytes.subarray(0, 2))).toBe("PK");
    const entries = unzipAll(pack.bytes);
    expect(entries.map((e) => e.name)).toContain("index.pdf");
    expect(entries.some((e) => e.name.endsWith("ein-letter.pdf"))).toBe(true);
    const everything = Buffer.concat(entries.map((e) => Buffer.from(e.data))).toString("latin1");
    expect(everything).not.toContain("98-7654321");
    const audit = await prisma.auditLog.findFirst({
      where: { action: "records.exported", userId: ownerId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();
  });

  it("exports an index-only pack with no file storage set up, but refuses when files can't be read", async () => {
    const bareId = await createPaperwork(
      ownerId,
      input({ kind: "LICENSE", numberLabel: "License number", numberValue: "LIC-5551234", title: `Bare export ${tag}` }),
    );
    createdRecordIds.push(bareId);
    const filedId = await createPaperwork(ownerId, input({ title: `Filed export ${tag}` }));
    createdRecordIds.push(filedId);
    await attachRecordFile(ownerId, filedId, { fileName: "scan.pdf", bytes: PDF_BYTES });
    m.store = null;
    try {
      const pack = await buildExportPack(ownerId, [bareId]);
      expect(new TextDecoder().decode(pack.bytes.subarray(0, 2))).toBe("PK");
      const entries = unzipAll(pack.bytes);
      expect(entries.map((e) => e.name)).toEqual(["index.pdf"]);
      const everything = Buffer.concat(entries.map((e) => Buffer.from(e.data))).toString("latin1");
      expect(everything).not.toContain("LIC-5551234");
      await expect(buildExportPack(ownerId, [filedId])).rejects.toThrow(/isn't set up/);
    } finally {
      m.store = { token: "test-token", storeId: "store_test" };
    }
  });

  it("gates direct-to-store uploads to the owner of an existing record", async () => {
    const id = await createPaperwork(ownerId, input({ title: `Upload gate ${tag}` }));
    createdRecordIds.push(id);
    const path = `records/${id}/file.pdf`;
    expect(await canUploadPhoto({ id: ownerId, role: "OWNER" }, path)).toBe(true);
    expect(await canUploadPhoto({ id: adminId, role: "ADMIN" }, path)).toBe(false);
    expect(await canUploadPhoto({ id: staffId, role: "STAFF" }, path)).toBe(false);
    expect(await canUploadPhoto({ id: ownerId, role: "OWNER" }, "records/no-such-record/file.pdf")).toBe(false);
  });

  it("follows the owner's admin-kinds setting", async () => {
    const id = await createPaperwork(ownerId, input({ kind: "BANK", title: `Bank ${tag}` }));
    createdRecordIds.push(id);
    expect(await getRecord("ADMIN", id)).toBeNull();
    await updatePaperworkAdminKinds(ownerId, ["BANK"]);
    expect((await getRecord("ADMIN", id))?.title).toContain("Bank");
    await updatePaperworkAdminKinds(ownerId, recommendedAdminKinds());
    expect(await getRecord("ADMIN", id)).toBeNull();
  });
});
