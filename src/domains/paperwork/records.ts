import { createHash, randomUUID } from "node:crypto";
import { get, put } from "@vercel/blob";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { BusinessPaperwork, BusinessRecordFile, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { getPrivatePhotoStore } from "@/lib/photo-storage";
import { getBusinessSettings } from "@/domains/settings";
import { createZip } from "@/lib/zip";
import { PAPERWORK_STALE_MESSAGE } from "./index";
import {
  RECORD_KIND_LABEL,
  contentDisposition,
  nextDueAfterRenewal,
  RECOMMENDED_ADMIN_KINDS,
  RECORD_PDF_MAX_BYTES,
  adminCanSeeRecord,
  effectiveRecordDate,
  isRecordKind,
  sniffRecordFile,
  type RecordKind,
} from "./rules";

export { contentDisposition };

/**
 * VAULT-1: business records on top of BusinessPaperwork.
 *
 * Access: OWNER sees and changes everything. ADMIN reads a record only when
 * the owner's "Kinds admins may see" setting lists its kind AND the record
 * holds no encrypted number (see rules.adminCanSeeRecord). Everyone else is
 * denied, and a record an admin may not see reads as "not found".
 *
 * The encrypted number NEVER leaves this module: DTOs carry only whether one
 * is on file and its last four characters. Files live in the private Blob
 * store; this module is the only reader/writer of records/ paths.
 */

export type RecordFileDto = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  label: string | null;
  uploadedAt: Date;
};

export type BusinessRecordDto = {
  id: string;
  templateKey: string | null;
  title: string;
  groupName: string;
  kind: string;
  kindLabel: string;
  status: string;
  whatItIs: string | null;
  agency: string | null;
  officialUrl: string | null;
  /** Owner-only reference text (EIN-style numbers the owner typed as a plain reference). Admins never receive it. */
  referenceNumber: string | null;
  numberLabel: string | null;
  hasNumber: boolean;
  numberLast4: string | null;
  startedOn: Date | null;
  issuedOn: Date | null;
  expiresOn: Date | null;
  dueOn: Date | null;
  /** The earlier of expiresOn / dueOn — what reminders key off. */
  effectiveDate: Date | null;
  remindDaysBefore: number;
  repeatEveryMonths: number | null;
  portalUrl: string | null;
  costCents: number | null;
  /** The same cost as a dollars string for form fields (money inputs are in dollars). */
  costDollars: string | null;
  linkedObligationKeys: string[];
  credentialId: string | null;
  notes: string | null;
  lastDoneOn: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  files: RecordFileDto[];
};

function toDto(row: BusinessPaperwork & { recordFiles?: BusinessRecordFile[] }, forAdmin: boolean): BusinessRecordDto {
  const kind = isRecordKind(row.kind) ? row.kind : "TASK";
  return {
    id: row.id,
    templateKey: row.templateKey,
    title: row.title,
    groupName: row.groupName,
    kind,
    kindLabel: RECORD_KIND_LABEL[kind],
    status: row.status,
    whatItIs: row.whatItIs,
    agency: row.agency,
    officialUrl: row.officialUrl,
    referenceNumber: forAdmin ? null : row.referenceNumber,
    numberLabel: row.numberLabel,
    hasNumber: row.numberEncrypted != null,
    numberLast4: row.numberLast4,
    startedOn: row.startedOn,
    issuedOn: row.issuedOn,
    expiresOn: row.expiresOn,
    dueOn: row.dueOn,
    effectiveDate: effectiveRecordDate(row),
    remindDaysBefore: row.remindDaysBefore,
    repeatEveryMonths: row.repeatEveryMonths,
    portalUrl: row.portalUrl,
    costCents: row.costCents,
    costDollars: row.costCents != null ? String(row.costCents / 100) : null,
    linkedObligationKeys: row.linkedObligationKeys,
    credentialId: row.credentialId,
    notes: forAdmin ? null : row.notes,
    lastDoneOn: row.lastDoneOn,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    files: (row.recordFiles ?? [])
      .filter((f) => f.deletedAt == null)
      .map((f) => ({
        id: f.id,
        fileName: f.fileName,
        contentType: f.contentType,
        sizeBytes: f.sizeBytes,
        label: f.label,
        uploadedAt: f.createdAt,
      })),
  };
}

async function adminKinds(): Promise<string[]> {
  const settings = await getBusinessSettings();
  return settings.paperworkAdminKinds ?? [];
}

export async function getPaperworkAdminKinds(): Promise<string[]> {
  return adminKinds();
}

/** Owner-only: replace the "Kinds admins may see" list. Kinds are validated against the known set. */
export async function updatePaperworkAdminKinds(userId: string, kinds: string[]): Promise<void> {
  const clean = [...new Set(kinds.filter(isRecordKind))];
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    await tx.businessSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", paperworkAdminKinds: clean },
      update: { paperworkAdminKinds: clean },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "records.admin_kinds_updated",
        entityType: "BusinessSettings",
        entityId: "singleton",
        newValue: { kinds: clean },
      },
    });
  });
}

export function recommendedAdminKinds(): RecordKind[] {
  return [...RECOMMENDED_ADMIN_KINDS];
}

export async function listRecords(role: string | undefined): Promise<BusinessRecordDto[]> {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw new Error("Only the owner and admins can see business records.");
  }
  const rows = await prisma.businessPaperwork.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    take: 500,
    include: { recordFiles: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } },
  });
  if (role === "OWNER") return rows.map((r) => toDto(r, false));
  const kinds = await adminKinds();
  return rows
    .filter((r) => adminCanSeeRecord({ kind: r.kind, hasNumber: r.numberEncrypted != null }, kinds))
    .map((r) => toDto(r, true));
}

/** One record with its current files, or null when it does not exist or this role may not see it. */
export async function getRecord(role: string | undefined, id: string): Promise<BusinessRecordDto | null> {
  if (role !== "OWNER" && role !== "ADMIN") return null;
  const row = await prisma.businessPaperwork.findUnique({
    where: { id },
    include: { recordFiles: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } },
  });
  if (!row) return null;
  if (role === "ADMIN") {
    const kinds = await adminKinds();
    if (!adminCanSeeRecord({ kind: row.kind, hasNumber: row.numberEncrypted != null }, kinds)) return null;
    return toDto(row, true);
  }
  return toDto(row, false);
}

async function audit(
  tx: Prisma.TransactionClient,
  userId: string,
  action: string,
  recordId: string,
  fields?: string[],
) {
  await tx.auditLog.create({
    data: {
      userId,
      action,
      entityType: "BusinessPaperwork",
      entityId: recordId,
      ...(fields ? { newValue: { fields } } : {}),
    },
  });
}

/** Owner-only: archive a record (kept, with its files, but out of the way and off the To do list). */
export async function archiveRecord(userId: string, id: string, expectedVersion: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const rows = await tx.$queryRaw<{ version: number }[]>`
      SELECT "version" FROM "BusinessPaperwork" WHERE "id" = ${id} FOR UPDATE`;
    if (!rows[0]) throw new Error("That record no longer exists.");
    if (rows[0].version !== expectedVersion) throw new Error(PAPERWORK_STALE_MESSAGE);
    await tx.businessPaperwork.update({
      where: { id },
      data: { status: "NOT_NEEDED", updatedByUserId: userId, version: { increment: 1 } },
    });
    await audit(tx, userId, "records.archived", id);
  });
}

/** Owner-only: remove the stored number (the label stays). */
export async function clearRecordNumber(userId: string, id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "BusinessPaperwork" WHERE "id" = ${id} FOR UPDATE`;
    if (!rows[0]) throw new Error("That record no longer exists.");
    await tx.businessPaperwork.update({
      where: { id },
      data: { numberEncrypted: null, numberLast4: null, updatedByUserId: userId, version: { increment: 1 } },
    });
    await audit(tx, userId, "records.number_cleared", id);
  });
}

/**
 * Owner-only: "Renewed…" — sets the record's new expiry (and next action date
 * when given), marks it in place, and keeps every existing file as history.
 * Without explicit dates, a repeating record advances by its repeat length.
 * When only a new expiry is given, an action date that belonged to the cycle
 * just renewed (on or before the old expiry) is cleared with it — otherwise
 * the renewed record would stay overdue on the old date.
 */
export async function renewRecord(
  userId: string,
  id: string,
  input: { expiresOn?: string | null; dueOn?: string | null; expectedVersion: number },
  now = new Date(),
): Promise<void> {
  const expiresOn = input.expiresOn ? businessDateFromKey(input.expiresOn) : undefined;
  const dueOn = input.dueOn ? businessDateFromKey(input.dueOn) : undefined;
  if (input.expiresOn && !expiresOn) throw new Error("That expiry date isn't a real date.");
  if (input.dueOn && !dueOn) throw new Error("That date isn't a real date.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const rows = await tx.$queryRaw<
      { version: number; expiresOn: Date | null; dueOn: Date | null; repeatEveryMonths: number | null }[]
    >`SELECT "version", "expiresOn", "dueOn", "repeatEveryMonths" FROM "BusinessPaperwork" WHERE "id" = ${id} FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new Error("That record no longer exists.");
    if (row.version !== input.expectedVersion) throw new Error(PAPERWORK_STALE_MESSAGE);
    let nextExpires = expiresOn;
    let nextDue: Date | null | undefined = dueOn;
    if (nextDue === undefined && nextExpires !== undefined && row.dueOn) {
      // The owner gave the new expiry but no new action date. When the old
      // action date was the binding date for the cycle just renewed (on or
      // before the old expiry — often the same day), that action is done:
      // clear it, or the renewed record would stay overdue on the old date.
      // A later action date is a separate future action and stays.
      const oldEffective =
        row.expiresOn && row.expiresOn < row.dueOn ? row.expiresOn : row.dueOn;
      if (row.dueOn.getTime() <= oldEffective.getTime()) nextDue = null;
    }
    if (nextExpires === undefined && nextDue === undefined) {
      if (!row.repeatEveryMonths) {
        throw new Error("Give the new expiry date — this record doesn't repeat on its own.");
      }
      if (row.expiresOn) nextExpires = nextDueAfterRenewal(row.expiresOn, row.repeatEveryMonths, now);
      if (row.dueOn) nextDue = nextDueAfterRenewal(row.dueOn, row.repeatEveryMonths, now);
      if (!nextExpires && !nextDue) {
        throw new Error("Give the new expiry date — this record has no date to advance.");
      }
    }
    await tx.businessPaperwork.update({
      where: { id },
      data: {
        ...(nextExpires !== undefined ? { expiresOn: nextExpires } : {}),
        ...(nextDue !== undefined ? { dueOn: nextDue } : {}),
        status: "DONE",
        lastDoneOn: now,
        updatedByUserId: userId,
        version: { increment: 1 },
      },
    });
    await audit(tx, userId, "records.renewed", id, [
      ...(nextExpires !== undefined ? ["expiresOn"] : []),
      ...(nextDue !== undefined ? ["dueOn"] : []),
    ]);
  });
}

// ---------------------------------------------------------------------------
// Files

function privateStoreOrThrow() {
  const store = getPrivatePhotoStore();
  if (!store) throw new Error("Private file storage isn't set up yet, so files can't be saved right now.");
  return store;
}

export type AttachFileInput = {
  fileName: string;
  bytes: Uint8Array;
  label?: string | null;
};

/**
 * Owner-only: attach a file whose bytes arrived with the request (the small
 * path — the caller enforces the 900 KB limit; large PDFs go through
 * registerUploadedRecordFile). Type is sniffed from the bytes, never the name.
 */
export async function attachRecordFile(
  userId: string,
  recordId: string,
  input: AttachFileInput,
): Promise<string> {
  const kind = sniffRecordFile(input.bytes);
  if (!kind) throw new Error("That file isn't a PDF or a photo (PNG, JPEG or WebP). It wasn't saved.");
  const store = privateStoreOrThrow();
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "BusinessPaperwork" WHERE "id" = ${recordId} FOR UPDATE`;
    if (!rows[0]) throw new Error("That record no longer exists.");
    const fileId = randomUUID();
    const pathname = `records/${recordId}/${fileId}.${kind.extension}`;
    await put(pathname, Buffer.from(input.bytes), {
      access: "private",
      token: store.token,
      contentType: kind.contentType,
      addRandomSuffix: false,
    });
    const file = await tx.businessRecordFile.create({
      data: {
        id: fileId,
        recordId,
        pathname,
        fileName: input.fileName.slice(0, 200) || `file.${kind.extension}`,
        contentType: kind.contentType,
        sizeBytes: input.bytes.length,
        sha256: createHash("sha256").update(input.bytes).digest("hex"),
        label: input.label?.slice(0, 120) || null,
        uploadedByUserId: userId,
      },
      select: { id: true },
    });
    await audit(tx, userId, "records.file_added", recordId, [file.id]);
    return file.id;
  });
}

/**
 * Owner-only: register a large PDF the browser uploaded straight to the
 * private store (token-gated by canUploadPhoto's records branch). The bytes
 * are read back to verify type, size and hash before the row is written, so a
 * token can never register a file that is not really a PDF for this record.
 */
export async function registerUploadedRecordFile(
  userId: string,
  recordId: string,
  input: { pathname: string; fileName: string; label?: string | null },
): Promise<string> {
  const prefix = `records/${recordId}/`;
  if (!input.pathname.startsWith(prefix) || input.pathname.includes("..")) {
    throw new Error("That upload doesn't belong to this record.");
  }
  const store = privateStoreOrThrow();
  const result = await get(input.pathname, { access: "private", token: store.token });
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error("That upload couldn't be found. Try uploading it again.");
  }
  const bytes = new Uint8Array(await new Response(result.stream as ReadableStream).arrayBuffer());
  if (bytes.length > RECORD_PDF_MAX_BYTES) {
    throw new Error("That PDF is larger than 15 MB. It wasn't saved.");
  }
  const kind = sniffRecordFile(bytes);
  if (!kind || kind.contentType !== "application/pdf") {
    throw new Error("Only PDF files can be uploaded this way. That file wasn't saved.");
  }
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "BusinessPaperwork" WHERE "id" = ${recordId} FOR UPDATE`;
    if (!rows[0]) throw new Error("That record no longer exists.");
    const existing = await tx.businessRecordFile.findUnique({
      where: { pathname: input.pathname },
      select: { id: true },
    });
    if (existing) return existing.id;
    const file = await tx.businessRecordFile.create({
      data: {
        recordId,
        pathname: input.pathname,
        fileName: input.fileName.slice(0, 200) || "file.pdf",
        contentType: kind.contentType,
        sizeBytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        label: input.label?.slice(0, 120) || null,
        uploadedByUserId: userId,
      },
      select: { id: true },
    });
    await audit(tx, userId, "records.file_added", recordId, [file.id]);
    return file.id;
  });
}

/** Owner-only: soft-delete a file (it stays in the record's history and in backups). */
export async function removeRecordFile(userId: string, recordId: string, fileId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const file = await tx.businessRecordFile.findFirst({
      where: { id: fileId, recordId, deletedAt: null },
      select: { id: true },
    });
    if (!file) return;
    await tx.businessRecordFile.update({ where: { id: fileId }, data: { deletedAt: new Date() } });
    await audit(tx, userId, "records.file_removed", recordId, [fileId]);
  });
}

/** Read one file's bytes for an authorized reader (the API route does the role gate via getRecord). */
export async function readRecordFileBytes(
  file: { pathname: string },
): Promise<{ bytes: Uint8Array } | null> {
  const store = getPrivatePhotoStore();
  if (!store) return null;
  const result = await get(file.pathname, { access: "private", token: store.token });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  const bytes = new Uint8Array(await new Response(result.stream as ReadableStream).arrayBuffer());
  return { bytes };
}

export async function getRecordFileRow(fileId: string): Promise<BusinessRecordFile | null> {
  return prisma.businessRecordFile.findFirst({ where: { id: fileId, deletedAt: null } });
}

export async function auditRecordDownload(userId: string, recordId: string, fileId: string): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId,
      action: "records.file_downloaded",
      entityType: "BusinessPaperwork",
      entityId: recordId,
      newValue: { fields: [fileId] },
    },
  });
}

/** The record page's history: audit rows for this record, newest first. */
export async function listRecordHistory(recordId: string, take = 50) {
  return prisma.auditLog.findMany({
    where: { entityType: "BusinessPaperwork", entityId: recordId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, action: true, createdAt: true, userId: true },
  });
}

// ---------------------------------------------------------------------------
// Export pack

function slugify(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug || "record";
}

async function buildIndexPdf(records: BusinessRecordDto[], exportedAt: Date): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([612, 792]);
  let y = 720;
  const line = (text: string, useBold = false, size = 11) => {
    if (y < 60) {
      page = pdf.addPage([612, 792]);
      y = 720;
    }
    page.drawText(text.slice(0, 110), { x: 50, y, size, font: useBold ? bold : font, color: rgb(0.09, 0.14, 0.11) });
    y -= size + 6;
  };
  line("Business records — export pack", true, 16);
  line(`Exported ${businessDateKey(exportedAt)} · ${records.length} record${records.length === 1 ? "" : "s"}`);
  line("Numbers are masked in this pack. Full numbers stay in the app, owner only.");
  y -= 6;
  for (const r of records) {
    line(`${r.title} (${r.kindLabel})`, true, 12);
    if (r.agency) line(`Agency: ${r.agency}`);
    if (r.numberLabel || r.hasNumber) {
      line(`${r.numberLabel ?? "Number"}: ${r.hasNumber ? `••••${r.numberLast4 ?? ""}` : "not on file"}`);
    }
    if (r.issuedOn) line(`Issued: ${businessDateKey(r.issuedOn)}`);
    if (r.expiresOn) line(`Expires: ${businessDateKey(r.expiresOn)}`);
    if (r.dueOn) line(`Next action: ${businessDateKey(r.dueOn)}`);
    if (r.portalUrl) line(`Portal: ${r.portalUrl}`);
    if (r.costCents != null) line(`Cost: $${(r.costCents / 100).toFixed(2)}`);
    line(r.files.length ? `Files: ${r.files.map((f) => f.fileName).join(", ")}` : "Files: none attached");
    y -= 6;
  }
  return pdf.save();
}

/**
 * Owner-only: the export pack — a ZIP of the chosen records' current files
 * plus a PDF index. Numbers are masked (VAULT-2's unlock governs any unmasked
 * export). Every export is audited with the record ids, never their contents.
 */
export async function buildExportPack(
  userId: string,
  recordIds: string[],
): Promise<{ fileName: string; bytes: Uint8Array }> {
  // The private store is only needed when a chosen record actually has
  // files to read; an index-only pack must work before storage is set up.
  let store: { token: string; storeId: string } | null | undefined;
  const storeForFiles = () => {
    if (store === undefined) store = getPrivatePhotoStore();
    if (!store) {
      throw new Error(
        "Private file storage isn't set up yet, so the stored files can't be read for the export.",
      );
    }
    return store;
  };
  // Only the snapshot read and the audit write run inside (short)
  // transactions. Downloading every attachment, generating the PDF and
  // compressing the ZIP happen outside: several 15 MB PDFs can take far
  // longer than a database transaction may live, and the export must not
  // die at its final step because the transaction expired.
  const rows = await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const found = await tx.businessPaperwork.findMany({
      where: { id: { in: recordIds } },
      include: { recordFiles: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    if (found.length === 0) throw new Error("Pick at least one record to export.");
    return found;
  });
  {
    const dtos = rows.map((r) => toDto(r, false));
    const entries: { name: string; data: Uint8Array }[] = [];
    const usedNames = new Set<string>();
    const unreadable: string[] = [];
    for (const row of rows) {
      const folder = slugify(row.title);
      for (const file of row.recordFiles) {
        const result = await get(file.pathname, { access: "private", token: storeForFiles().token });
        if (!result || result.statusCode !== 200 || !result.stream) {
          // Never hand over a pack that silently leaves a document out: the
          // index lists every attached file, so a missing one fails the
          // export by name instead of pretending the pack is complete.
          unreadable.push(`${row.title} — ${file.fileName}`);
          continue;
        }
        const bytes = new Uint8Array(await new Response(result.stream as ReadableStream).arrayBuffer());
        let name = `${folder}/${file.fileName}`;
        let n = 2;
        while (usedNames.has(name)) {
          name = `${folder}/${file.fileName.replace(/(\.[^.]+)?$/, `-${n}$1`)}`;
          n += 1;
        }
        usedNames.add(name);
        entries.push({ name, data: bytes });
      }
    }
    if (unreadable.length > 0) {
      throw new Error(
        `The export stopped because ${unreadable.length === 1 ? "this file" : "these files"} couldn't be read from storage: ${unreadable.join("; ")}. Nothing was exported — check the file is still in storage, then try again.`,
      );
    }
    const index = await buildIndexPdf(dtos, new Date());
    entries.unshift({ name: "index.pdf", data: index });
    const bytes = createZip(entries, new Date());
    await prisma.$transaction(async (tx) => {
      await assertActiveTeamActor(tx, userId, ["OWNER"]);
      await audit(tx, userId, "records.exported", "export", dtos.map((d) => d.id));
    });
    return { fileName: `business-records-${businessDateKey(new Date())}.zip`, bytes };
  }
}
