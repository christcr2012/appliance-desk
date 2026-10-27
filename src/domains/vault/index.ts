import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateKey } from "@/lib/business-date";
import { decryptVaultField, encryptVaultField, hasVaultCryptoKey } from "@/lib/field-crypto";
import { maskUsername, rotationState, type VaultField } from "./rules";
import { inputTouchesSecrets, type VaultCredentialInput } from "./schema";
import { requireVaultUnlock, VaultError } from "./unlock";

/**
 * VAULT-2: the logins themselves (spec §§4-6). OWNER only — every function
 * re-checks the actor, and anyone else gets the same answer as a missing
 * login. DTOs never carry a ciphertext: lists show a masked username, and a
 * secret value leaves this module only through revealField (unlock-gated,
 * one field, audited) and the emergency export.
 */

export class VaultAccessError extends Error {}

const NOT_FOUND = "That login no longer exists.";

async function assertOwner(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, archivedAt: true } });
  if (!user || user.archivedAt || user.role !== "OWNER") throw new VaultAccessError(NOT_FOUND);
}

function assertVaultKeyForSecrets(): void {
  if (!hasVaultCryptoKey()) {
    throw new VaultError("The vault isn't set up yet — the vault encryption key is missing, so nothing can be saved safely.");
  }
}

export type VaultCredentialListItem = {
  id: string;
  title: string;
  url: string | null;
  usernameMasked: string | null;
  hasUsername: boolean;
  hasPassword: boolean;
  hasNotes: boolean;
  totpHint: string | null;
  lastRotatedOn: string | null;
  rotateEveryMonths: number | null;
  rotation: { dueOnKey: string; overdue: boolean } | null;
  linkedRecords: { id: string; title: string }[];
};

export type VaultCredentialDetail = VaultCredentialListItem & {
  createdAt: string;
  updatedAt: string;
  version: number;
};

type CredentialRow = {
  id: string;
  title: string;
  url: string | null;
  usernameEncrypted: string | null;
  passwordEncrypted: string | null;
  notesEncrypted: string | null;
  totpHint: string | null;
  lastRotatedOn: Date | null;
  rotateEveryMonths: number | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

function maskedUsername(row: CredentialRow): string | null {
  if (!row.usernameEncrypted) return null;
  try {
    return maskUsername(decryptVaultField(row.usernameEncrypted));
  } catch {
    return "•••";
  }
}

function toListItem(row: CredentialRow, linkedRecords: { id: string; title: string }[], now: Date): VaultCredentialListItem {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    usernameMasked: maskedUsername(row),
    hasUsername: row.usernameEncrypted != null,
    hasPassword: row.passwordEncrypted != null,
    hasNotes: row.notesEncrypted != null,
    totpHint: row.totpHint,
    lastRotatedOn: row.lastRotatedOn ? businessDateKey(row.lastRotatedOn) : null,
    rotateEveryMonths: row.rotateEveryMonths,
    rotation: rotationState(row, now),
    linkedRecords,
  };
}

async function linkedRecordsByCredential(ids: string[]): Promise<Map<string, { id: string; title: string }[]>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.businessPaperwork.findMany({
    where: { credentialId: { in: ids } },
    select: { id: true, title: true, credentialId: true },
    orderBy: { title: "asc" },
  });
  const map = new Map<string, { id: string; title: string }[]>();
  for (const row of rows) {
    if (!row.credentialId) continue;
    const list = map.get(row.credentialId) ?? [];
    list.push({ id: row.id, title: row.title });
    map.set(row.credentialId, list);
  }
  return map;
}

export async function listCredentials(userId: string, now = new Date()): Promise<VaultCredentialListItem[]> {
  await assertOwner(userId);
  const rows = await prisma.vaultCredential.findMany({ orderBy: { title: "asc" } });
  const links = await linkedRecordsByCredential(rows.map((r) => r.id));
  return rows.map((row) => toListItem(row, links.get(row.id) ?? [], now));
}

export async function getCredential(userId: string, id: string, now = new Date()): Promise<VaultCredentialDetail | null> {
  await assertOwner(userId);
  const row = await prisma.vaultCredential.findUnique({ where: { id } });
  if (!row) return null;
  const links = await linkedRecordsByCredential([id]);
  return {
    ...toListItem(row, links.get(id) ?? [], now),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function encryptSecret(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === "") return null;
  return encryptVaultField(value);
}

export async function createCredential(
  userId: string,
  sessionId: string,
  input: VaultCredentialInput,
): Promise<{ id: string }> {
  if (inputTouchesSecrets(input)) {
    assertVaultKeyForSecrets();
    await requireVaultUnlock(userId, sessionId);
  }
  const created = await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const row = await tx.vaultCredential.create({
      data: {
        title: input.title,
        url: input.url ?? null,
        usernameEncrypted: encryptSecret(input.username) ?? null,
        passwordEncrypted: encryptSecret(input.password) ?? null,
        notesEncrypted: encryptSecret(input.notes) ?? null,
        totpHint: input.totpHint ?? null,
        rotateEveryMonths: input.rotateEveryMonths ?? null,
      },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "vault.created",
        entityType: "VaultCredential",
        entityId: row.id,
        newValue: { fields: ["title", ...(input.username ? ["username"] : []), ...(input.password ? ["password"] : []), ...(input.notes ? ["notes"] : [])] },
      },
    });
    return row;
  });
  return { id: created.id };
}

export async function updateCredential(
  userId: string,
  sessionId: string,
  id: string,
  input: VaultCredentialInput,
  expectedVersion: number,
): Promise<void> {
  if (inputTouchesSecrets(input)) {
    assertVaultKeyForSecrets();
    await requireVaultUnlock(userId, sessionId);
  }
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const locked = await tx.$queryRaw<{ version: number }[]>`SELECT "version" FROM "VaultCredential" WHERE "id" = ${id} FOR UPDATE`;
    const row = locked[0];
    if (!row) throw new VaultAccessError(NOT_FOUND);
    if (row.version !== expectedVersion) {
      throw new VaultError("This login changed while you were looking at it. Reload the page and try again.");
    }
    const changed: string[] = [];
    const data: Record<string, unknown> = { version: { increment: 1 } };
    const set = (field: string, value: unknown) => {
      data[field] = value;
      changed.push(field);
    };
    set("title", input.title);
    set("url", input.url ?? null);
    set("totpHint", input.totpHint ?? null);
    set("rotateEveryMonths", input.rotateEveryMonths ?? null);
    const username = encryptSecret(input.username);
    if (username !== undefined) set("usernameEncrypted", username);
    const password = encryptSecret(input.password);
    if (password !== undefined) set("passwordEncrypted", password);
    const notes = encryptSecret(input.notes);
    if (notes !== undefined) set("notesEncrypted", notes);
    await tx.vaultCredential.update({ where: { id }, data });
    await tx.auditLog.create({
      data: {
        userId,
        action: "vault.updated",
        entityType: "VaultCredential",
        entityId: id,
        newValue: { fields: changed.map((f) => f.replace("Encrypted", "")) },
      },
    });
  });
}

export async function deleteCredential(userId: string, id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "VaultCredential" WHERE "id" = ${id} FOR UPDATE`;
    if (!locked[0]) throw new VaultAccessError(NOT_FOUND);
    await tx.businessPaperwork.updateMany({ where: { credentialId: id }, data: { credentialId: null } });
    await tx.vaultCredential.delete({ where: { id } });
    await tx.auditLog.create({
      data: { userId, action: "vault.deleted", entityType: "VaultCredential", entityId: id, newValue: {} },
    });
  });
}

/** Records that the owner changed the password today — restarts the rotation clock. No secret is touched. */
export async function markCredentialRotated(userId: string, id: string, now = new Date()): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "VaultCredential" WHERE "id" = ${id} FOR UPDATE`;
    if (!locked[0]) throw new VaultAccessError(NOT_FOUND);
    await tx.vaultCredential.update({
      where: { id },
      data: { lastRotatedOn: now, version: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "vault.rotated",
        entityType: "VaultCredential",
        entityId: id,
        newValue: { lastRotatedOn: businessDateKey(now) },
      },
    });
  });
}

/**
 * The one-field-at-a-time reveal (spec §5). Needs a live unlock for this
 * exact session; writes a vault.reveal audit row with the field and purpose
 * — never the value — and returns the plaintext to the caller (the screen),
 * which hides it again after 30 seconds.
 */
export async function revealField(
  userId: string,
  sessionId: string,
  credentialId: string,
  field: VaultField,
  purpose: "show" | "copy",
): Promise<{ value: string }> {
  await requireVaultUnlock(userId, sessionId);
  await assertOwner(userId);
  const row = await prisma.vaultCredential.findUnique({ where: { id: credentialId } });
  if (!row) throw new VaultAccessError(NOT_FOUND);
  const stored = field === "username" ? row.usernameEncrypted : field === "password" ? row.passwordEncrypted : row.notesEncrypted;
  if (!stored) throw new VaultError(`That login has no ${field} saved.`);
  let value: string;
  try {
    value = decryptVaultField(stored);
  } catch {
    throw new VaultError("That login can't be read — the vault encryption key may have changed.");
  }
  await prisma.auditLog.create({
    data: {
      userId,
      action: "vault.reveal",
      entityType: "VaultCredential",
      entityId: credentialId,
      newValue: { field, purpose },
    },
  });
  return { value };
}

// ---- Linking logins to business records (VAULT-1's credentialId) ----

export type LinkableRecord = { id: string; title: string; linkedCredentialId: string | null; linkedCredentialTitle: string | null };

export async function listRecordsForLinking(userId: string): Promise<LinkableRecord[]> {
  await assertOwner(userId);
  const [records, credentials] = await Promise.all([
    prisma.businessPaperwork.findMany({ select: { id: true, title: true, credentialId: true }, orderBy: { title: "asc" } }),
    prisma.vaultCredential.findMany({ select: { id: true, title: true } }),
  ]);
  const titles = new Map(credentials.map((c) => [c.id, c.title]));
  return records.map((r) => ({
    id: r.id,
    title: r.title,
    linkedCredentialId: r.credentialId,
    linkedCredentialTitle: r.credentialId ? (titles.get(r.credentialId) ?? null) : null,
  }));
}

/** The credential linked to one record, for the record page's Login card. Null when unlinked or missing. */
export async function getCredentialForRecord(
  userId: string,
  recordId: string,
): Promise<{ id: string; title: string } | null> {
  await assertOwner(userId);
  const record = await prisma.businessPaperwork.findUnique({ where: { id: recordId }, select: { credentialId: true } });
  if (!record?.credentialId) return null;
  const credential = await prisma.vaultCredential.findUnique({ where: { id: record.credentialId }, select: { id: true, title: true } });
  return credential;
}

export async function linkRecordToCredential(userId: string, credentialId: string, recordId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const credential = await tx.vaultCredential.findUnique({ where: { id: credentialId }, select: { id: true } });
    if (!credential) throw new VaultAccessError(NOT_FOUND);
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "BusinessPaperwork" WHERE "id" = ${recordId} FOR UPDATE`;
    if (!locked[0]) throw new VaultError("That record no longer exists.");
    await tx.businessPaperwork.update({ where: { id: recordId }, data: { credentialId, version: { increment: 1 } } });
    await tx.auditLog.create({
      data: { userId, action: "vault.linked", entityType: "VaultCredential", entityId: credentialId, newValue: { recordId } },
    });
  });
}

export async function unlinkRecord(userId: string, recordId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const locked = await tx.$queryRaw<{ credentialId: string | null }[]>`SELECT "credentialId" FROM "BusinessPaperwork" WHERE "id" = ${recordId} FOR UPDATE`;
    const row = locked[0];
    if (!row) throw new VaultError("That record no longer exists.");
    await tx.businessPaperwork.update({ where: { id: recordId }, data: { credentialId: null, version: { increment: 1 } } });
    await tx.auditLog.create({
      data: {
        userId,
        action: "vault.unlinked",
        entityType: "VaultCredential",
        entityId: row.credentialId ?? recordId,
        newValue: { recordId },
      },
    });
  });
}
