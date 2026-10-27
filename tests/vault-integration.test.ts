import { randomBytes, randomUUID } from "node:crypto";
import { inflateRawSync, inflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// VAULT-2 on real disposable Postgres: owner-only boundary, unlock-gated
// secrets (grant, 5-minute expiry, session binding, lockout), audited
// reveals that never carry the value, clearing on sign-out-everywhere, and
// the emergency-access lifecycle end to end (ships off; link, wait, deny,
// reminders stamped once, code to the SAVED contact, one-time export).
// Email/SMS are captured in-memory; blob storage is the VAULT-1 stand-in.
const m = vi.hoisted(() => ({
  sentMail: [] as { to: string; subject: string; text: string }[],
  sentSms: [] as { to: string; body: string }[],
  blobs: new Map<string, Uint8Array>(),
  store: { token: "test-token", storeId: "store_test" } as { token: string; storeId: string } | null,
}));
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async (input: { to: string; subject: string; text: string }) => {
    m.sentMail.push(input);
    return { sent: true, outcome: "SENT" };
  }),
}));
vi.mock("@/lib/sms", () => ({
  sendSms: vi.fn(async (input: { to: string; body: string }) => {
    m.sentSms.push(input);
    return { outcome: "SENT" };
  }),
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
import {
  createCredential,
  deleteCredential,
  getCredential,
  getCredentialForRecord,
  linkRecordToCredential,
  listCredentials,
  markCredentialRotated,
  revealField,
  unlinkRecord,
  updateCredential,
  VaultAccessError,
} from "@/domains/vault";
import {
  clearVaultUnlocks,
  getVaultUnlockStatus,
  grantVaultUnlock,
  recordFailedVaultUnlock,
} from "@/domains/vault/unlock";
import {
  createEmergencyLink,
  denyEmergencyRequest,
  downloadEmergencyExport,
  getEmergencyOwnerView,
  getPublicEmergencyState,
  requestEmergencyAccess,
  runEmergencyReminders,
  sendEmergencyCode,
  confirmEmergencyCode,
  updateEmergencySettings,
} from "@/domains/vault/emergency";
import { listVaultRotationAttention } from "@/domains/vault/attention";
import { revokeOtherSessions } from "@/domains/security/sessions";
import { createPaperwork } from "@/domains/paperwork";

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

/** pdf-lib compresses its content streams and draws text as hex strings.
 * Work on raw bytes (a windows-1252 string round-trip would corrupt the
 * compressed bytes): find each stream by the /Length declared just before
 * it, inflate, and decode the hex text runs to read what the PDF says. */
function pdfText(pdf: Uint8Array): string {
  const buf = Buffer.from(pdf);
  let text = buf.toString("latin1");
  let from = 0;
  for (;;) {
    const streamAt = buf.indexOf("stream\n", from);
    if (streamAt < 0) break;
    const dataStart = streamAt + "stream\n".length;
    const dict = buf.subarray(Math.max(0, streamAt - 120), streamAt).toString("latin1");
    const lengthMatches = [...dict.matchAll(/\/Length (\d+)/g)];
    const declared = lengthMatches.length ? Number(lengthMatches[lengthMatches.length - 1][1]) : buf.length - dataStart;
    try {
      text += inflateSync(buf.subarray(dataStart, dataStart + declared)).toString("latin1");
    } catch {
      // Not a compressed stream; its raw bytes are already in the text.
    }
    from = dataStart + Math.max(declared, 1);
  }
  for (const match of text.matchAll(/<([0-9A-Fa-f]{2,})>\s*Tj/g)) {
    text += Buffer.from(match[1], "hex").toString("latin1");
  }
  return text;
}

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

describe.skipIf(!enabled)("VAULT-2 logins vault and emergency access (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 12);
  const ownerId = `vault2-owner-${tag}`;
  const adminId = `vault2-admin-${tag}`;
  const staffId = `vault2-staff-${tag}`;
  const sessionId = `vault2-session-${tag}`;
  const otherSessionId = `vault2-other-session-${tag}`;
  const SECRET_USER = `vault-user-${tag}@example.test`;
  const SECRET_PASS = `Vault!Pass-${tag}`;
  const SECRET_NOTES = `Recovery code ${tag}`;
  const CONTACT_EMAIL = `contact-${tag}@example.test`;

  beforeAll(async () => {
    process.env.VAULT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    process.env.COMPLIANCE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${ownerId}@example.test`, name: "Owner", role: "OWNER" },
        { id: adminId, email: `${adminId}@example.test`, name: "Admin", role: "ADMIN" },
        { id: staffId, email: `${staffId}@example.test`, name: "Staff", role: "STAFF" },
      ],
    });
    // The emergency export packs every record; another serial suite's live
    // file rows would be unreadable from this process's in-memory store, so
    // soft-delete any pre-existing record files (this suite is serial with
    // the VAULT-1 suite that creates them).
    await prisma.businessRecordFile.updateMany({ data: { deletedAt: new Date() } });
    await prisma.emergencyAccessRequest.deleteMany({});
  });

  afterAll(async () => {
    await prisma.vaultUnlock.deleteMany({ where: { userId: { in: [ownerId, adminId, staffId] } } });
    await prisma.vaultCredential.deleteMany({});
    await prisma.emergencyAccessRequest.deleteMany({});
    await prisma.businessSettings.updateMany({
      data: {
        emergencyAccessEnabled: false,
        emergencyContactName: null,
        emergencyContactEmail: null,
        emergencyContactPhone: null,
        emergencyWaitDays: 7,
      },
    });
    await prisma.auditLog.deleteMany({ where: { userId: { in: [ownerId, adminId, staffId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId, staffId] } } });
    delete process.env.VAULT_ENCRYPTION_KEY;
    delete process.env.COMPLIANCE_ENCRYPTION_KEY;
  });

  it("refuses every non-owner with the same not-found answer", async () => {
    const { id } = await createCredential(ownerId, sessionId, { title: `Boundary ${tag}`, url: null, totpHint: null, rotateEveryMonths: null });
    await expect(listCredentials(adminId)).rejects.toBeInstanceOf(VaultAccessError);
    await expect(getCredential(staffId, id)).rejects.toBeInstanceOf(VaultAccessError);
    await expect(createCredential(adminId, sessionId, { title: "Nope", url: null, totpHint: null, rotateEveryMonths: null })).rejects.toThrow();
    await expect(getCredential(ownerId, `missing-${tag}`)).resolves.toBeNull();
    await deleteCredential(ownerId, id);
  });

  it("saves a title-only login without an unlock, and DTOs never carry a secret", async () => {
    const { id } = await createCredential(ownerId, sessionId, {
      title: `Plain ${tag}`,
      url: "https://example.test/login",
      totpHint: null,
      rotateEveryMonths: null,
    });
    const list = await listCredentials(ownerId);
    const item = list.find((c) => c.id === id);
    expect(item).toBeTruthy();
    expect(item?.hasPassword).toBe(false);
    expect(JSON.stringify(list)).not.toContain("Encrypted");
    await deleteCredential(ownerId, id);
  });

  it("refuses to save a secret at all while the vault key is missing", async () => {
    const key = process.env.VAULT_ENCRYPTION_KEY;
    delete process.env.VAULT_ENCRYPTION_KEY;
    try {
      await grantVaultUnlock(ownerId, sessionId);
      await expect(
        createCredential(ownerId, sessionId, {
          title: `No key ${tag}`,
          url: null,
          password: SECRET_PASS,
          totpHint: null,
          rotateEveryMonths: null,
        }),
      ).rejects.toThrow(/isn't set up yet/i);
    } finally {
      process.env.VAULT_ENCRYPTION_KEY = key;
      await clearVaultUnlocks(ownerId);
    }
  });

  it("refuses to save a secret without an unlock; with one, stores ciphertext only", async () => {
    await expect(
      createCredential(ownerId, sessionId, {
        title: `Secret ${tag}`,
        url: null,
        username: SECRET_USER,
        password: SECRET_PASS,
        notes: SECRET_NOTES,
        totpHint: "Authenticator app",
        rotateEveryMonths: null,
      }),
    ).rejects.toThrow(/unlock/i);

    await grantVaultUnlock(ownerId, sessionId);
    const { id } = await createCredential(ownerId, sessionId, {
      title: `Secret ${tag}`,
      url: null,
      username: SECRET_USER,
      password: SECRET_PASS,
      notes: SECRET_NOTES,
      totpHint: "Authenticator app",
      rotateEveryMonths: null,
    });
    const row = await prisma.vaultCredential.findUnique({ where: { id } });
    expect(row?.passwordEncrypted?.startsWith("v1:")).toBe(true);
    expect(JSON.stringify(row)).not.toContain(SECRET_PASS);
    expect(JSON.stringify(row)).not.toContain(SECRET_USER);

    const detail = await getCredential(ownerId, id);
    expect(detail?.usernameMasked).toBe(`v•••@example.test`);
    expect(detail?.hasPassword).toBe(true);
    expect(JSON.stringify(detail)).not.toContain(SECRET_PASS);
    await clearVaultUnlocks(ownerId);
    await deleteCredential(ownerId, id);
  });

  it("reveals one field at a time, audited without the value, bound to the session", async () => {
    await grantVaultUnlock(ownerId, sessionId);
    const { id } = await createCredential(ownerId, sessionId, {
      title: `Reveal ${tag}`,
      url: null,
      username: SECRET_USER,
      password: SECRET_PASS,
      totpHint: null,
      rotateEveryMonths: null,
    });
    await clearVaultUnlocks(ownerId);
    await expect(revealField(ownerId, sessionId, id, "password", "show")).rejects.toThrow(/unlock/i);

    await grantVaultUnlock(ownerId, sessionId);
    await expect(revealField(ownerId, otherSessionId, id, "password", "show")).rejects.toThrow(/unlock/i);
    const { value } = await revealField(ownerId, sessionId, id, "password", "copy");
    expect(value).toBe(SECRET_PASS);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "vault.reveal", entityId: id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit)).not.toContain(SECRET_PASS);
    expect((audit?.newValue as { field?: string })?.field).toBe("password");
    await deleteCredential(ownerId, id);
  });

  it("an expired unlock no longer reveals", async () => {
    await grantVaultUnlock(ownerId, sessionId);
    const { id } = await createCredential(ownerId, sessionId, {
      title: `Expiry ${tag}`,
      url: null,
      password: SECRET_PASS,
      totpHint: null,
      rotateEveryMonths: null,
    });
    await prisma.vaultUnlock.updateMany({
      where: { userId: ownerId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const status = await getVaultUnlockStatus(ownerId, sessionId);
    expect(status.unlocked).toBe(false);
    await expect(revealField(ownerId, sessionId, id, "password", "show")).rejects.toThrow(/unlock/i);
    await deleteCredential(ownerId, id);
  });

  it("locks after 5 failed codes in the window and emails the owner", async () => {
    await prisma.auditLog.deleteMany({ where: { userId: ownerId, action: { startsWith: "vault." } } });
    m.sentMail.length = 0;
    for (let i = 0; i < 4; i++) {
      const s = await recordFailedVaultUnlock(ownerId);
      expect(s.locked).toBe(false);
    }
    const fifth = await recordFailedVaultUnlock(ownerId);
    expect(fifth.locked).toBe(true);
    await expect(grantVaultUnlock(ownerId, sessionId)).rejects.toThrow(/locked/i);
    const lockAudit = await prisma.auditLog.findFirst({ where: { userId: ownerId, action: "vault.locked" } });
    expect(lockAudit).toBeTruthy();
    expect(m.sentMail.some((mail) => mail.subject.includes("vault is locked"))).toBe(true);
    // Clean the failure rows so later tests start unlocked.
    await prisma.auditLog.deleteMany({ where: { userId: ownerId, action: { startsWith: "vault." } } });
  });

  it("signing out everywhere clears unlocks", async () => {
    await prisma.session.create({
      data: { userId: ownerId, token: `vault2-token-${tag}`, expiresAt: new Date(Date.now() + 3_600_000) },
    });
    await grantVaultUnlock(ownerId, sessionId);
    expect((await getVaultUnlockStatus(ownerId, sessionId)).unlocked).toBe(true);
    await revokeOtherSessions(ownerId, `vault2-token-${tag}`);
    expect((await getVaultUnlockStatus(ownerId, sessionId)).unlocked).toBe(false);
  });

  it("updates need the version, secret changes need an unlock, and clearing works", async () => {
    await grantVaultUnlock(ownerId, sessionId);
    const { id } = await createCredential(ownerId, sessionId, {
      title: `Update ${tag}`,
      url: null,
      password: SECRET_PASS,
      totpHint: null,
      rotateEveryMonths: null,
    });
    const detail = await getCredential(ownerId, id);
    await expect(
      updateCredential(ownerId, sessionId, id, { title: `Update ${tag} v2`, url: null, totpHint: null, rotateEveryMonths: null }, (detail?.version ?? 1) + 5),
    ).rejects.toThrow(/changed/i);
    await clearVaultUnlocks(ownerId);
    await expect(
      updateCredential(ownerId, sessionId, id, { title: `Update ${tag} v2`, url: null, password: "NewPass!234", totpHint: null, rotateEveryMonths: null }, detail!.version),
    ).rejects.toThrow(/unlock/i);
    await grantVaultUnlock(ownerId, sessionId);
    await updateCredential(ownerId, sessionId, id, { title: `Update ${tag} v2`, url: null, password: "", totpHint: null, rotateEveryMonths: null }, detail!.version);
    const after = await getCredential(ownerId, id);
    expect(after?.title).toBe(`Update ${tag} v2`);
    expect(after?.hasPassword).toBe(false);
    await deleteCredential(ownerId, id);
  });

  it("rotation: marking rotated resets the clock, and overdue logins reach the To do source", async () => {
    const { id } = await createCredential(ownerId, sessionId, {
      title: `Rotate ${tag}`,
      url: null,
      totpHint: null,
      rotateEveryMonths: 1,
    });
    await prisma.vaultCredential.update({ where: { id }, data: { createdAt: new Date(Date.now() - 40 * 86_400_000) } });
    const before = await listVaultRotationAttention(new Date());
    expect(before.some((row) => row.title.includes(`Rotate ${tag}`))).toBe(true);
    await markCredentialRotated(ownerId, id);
    const after = await listVaultRotationAttention(new Date());
    expect(after.some((row) => row.title.includes(`Rotate ${tag}`))).toBe(false);
    await deleteCredential(ownerId, id);
  });

  it("links a login to a record and unlinks cleanly; deleting the login clears the link", async () => {
    const recordId = await createPaperwork(ownerId, {
      title: `Vault link record ${tag}`,
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
      kind: "ACCOUNT",
      issuedOn: null,
      expiresOn: null,
      numberLabel: null,
      numberValue: null,
      portalUrl: null,
      costDollars: null,
      linkedObligationKeys: [],
    } as Parameters<typeof createPaperwork>[1]);
    const { id } = await createCredential(ownerId, sessionId, { title: `Link ${tag}`, url: null, totpHint: null, rotateEveryMonths: null });
    await linkRecordToCredential(ownerId, id, recordId);
    expect((await getCredentialForRecord(ownerId, recordId))?.id).toBe(id);
    await unlinkRecord(ownerId, recordId);
    expect(await getCredentialForRecord(ownerId, recordId)).toBeNull();
    await linkRecordToCredential(ownerId, id, recordId);
    await deleteCredential(ownerId, id);
    expect(await getCredentialForRecord(ownerId, recordId)).toBeNull();
    await prisma.businessPaperwork.delete({ where: { id: recordId } });
  });

  it("emergency access is inert while switched off", async () => {
    await updateEmergencySettings(ownerId, { enabled: false, contactName: "Pat", contactEmail: CONTACT_EMAIL, contactPhone: "", waitDays: 7 });
    await expect(createEmergencyLink(ownerId)).rejects.toThrow(/on/i);
    expect((await getPublicEmergencyState("no-such-token")).state).toBe("inactive");
  });

  it("emergency: deny ends a waiting request, and reminders are stamped once", async () => {
    await updateEmergencySettings(ownerId, { enabled: true, contactName: "Pat", contactEmail: CONTACT_EMAIL, contactPhone: "", waitDays: 2 });
    m.sentMail.length = 0;
    const { token } = await createEmergencyLink(ownerId);
    expect((await getPublicEmergencyState(token)).state).toBe("ready");
    await requestEmergencyAccess(token);
    expect((await getPublicEmergencyState(token)).state).toBe("waiting");
    // The start reminder went out to the owner (the app's owner account),
    // never to the contact.
    expect(m.sentMail.some((mail) => mail.subject.includes("Emergency access was requested"))).toBe(true);
    expect(m.sentMail.some((mail) => mail.to === CONTACT_EMAIL)).toBe(false);

    const view = await getEmergencyOwnerView(ownerId);
    const requestId = view.active?.id;
    expect(requestId).toBeTruthy();
    // 25 hours into a 2-day wait (ends in 23 hours): the day-before reminder
    // point has passed, so exactly one reminder fires and both stamps land.
    await prisma.emergencyAccessRequest.update({
      where: { id: requestId! },
      data: {
        requestedAt: new Date(Date.now() - 25 * 3_600_000),
        waitEndsAt: new Date(Date.now() + 23 * 3_600_000),
      },
    });
    const first = await runEmergencyReminders(new Date());
    expect(first.reminded).toBeGreaterThanOrEqual(1);
    const stamped = await prisma.emergencyAccessRequest.findUnique({ where: { id: requestId! } });
    expect(stamped?.remindedHalfwayAt).toBeTruthy();
    const second = await runEmergencyReminders(new Date());
    expect(second.reminded).toBe(0);

    await denyEmergencyRequest(ownerId, requestId!);
    expect((await getPublicEmergencyState(token)).state).toBe("denied");
  });

  it("emergency: the code goes to the saved contact, and the export downloads exactly once", async () => {
    await updateEmergencySettings(ownerId, { enabled: true, contactName: "Pat", contactEmail: CONTACT_EMAIL, contactPhone: "", waitDays: 1 });
    await grantVaultUnlock(ownerId, sessionId);
    const { id } = await createCredential(ownerId, sessionId, {
      title: `Export ${tag}`,
      url: null,
      username: SECRET_USER,
      password: SECRET_PASS,
      totpHint: null,
      rotateEveryMonths: null,
    });
    // One business record, so the export carries the records pack too.
    const recordId = await createPaperwork(ownerId, {
      title: `Export record ${tag}`,
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
      kind: "ACCOUNT",
      issuedOn: null,
      expiresOn: null,
      numberLabel: null,
      numberValue: null,
      portalUrl: null,
      costDollars: null,
      linkedObligationKeys: [],
    } as Parameters<typeof createPaperwork>[1]);
    const { token } = await createEmergencyLink(ownerId);
    // The settings change AFTER the link exists; the code must still go to
    // the snapshot taken when the link was created.
    await updateEmergencySettings(ownerId, { enabled: true, contactName: "Pat", contactEmail: `changed-${tag}@example.test`, contactPhone: "", waitDays: 1 });
    await requestEmergencyAccess(token);
    const view = await getEmergencyOwnerView(ownerId);
    await prisma.emergencyAccessRequest.update({
      where: { id: view.active!.id },
      data: { waitEndsAt: new Date(Date.now() - 60_000) },
    });
    expect((await getPublicEmergencyState(token)).state).toBe("ready_for_code");

    m.sentMail.length = 0;
    const { channel } = await sendEmergencyCode(token);
    expect(channel).toBe("email");
    const codeMail = m.sentMail.find((mail) => mail.subject.includes("emergency access code"));
    expect(codeMail?.to).toBe(CONTACT_EMAIL);
    const code = codeMail?.text.match(/\b(\d{6})\b/)?.[1];
    expect(code).toBeTruthy();

    await expect(confirmEmergencyCode(token, "000000")).rejects.toThrow(/not accepted/i);
    await confirmEmergencyCode(token, code!);
    expect((await getPublicEmergencyState(token)).state).toBe("verified");

    const download = await downloadEmergencyExport(token);
    expect(download.fileName).toBe("emergency-export.zip");
    const entries = unzipAll(download.bytes);
    const names = entries.map((e) => e.name);
    expect(names).toContain("logins-vault.pdf");
    expect(names).toContain("READ-ME.txt");
    expect(names.some((n) => n.endsWith(".zip"))).toBe(true);
    const pdf = entries.find((e) => e.name === "logins-vault.pdf");
    const text = pdfText(pdf!.data);
    expect(text).toContain(`Export ${tag}`);
    expect(text).toContain(SECRET_PASS);

    expect((await getPublicEmergencyState(token)).state).toBe("consumed");
    await expect(downloadEmergencyExport(token)).rejects.toThrow();
    await deleteCredential(ownerId, id);
    await prisma.businessPaperwork.delete({ where: { id: recordId } });
  });
});
