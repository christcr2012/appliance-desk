import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { decryptVaultField, hasVaultCryptoKey } from "@/lib/field-crypto";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { createZip } from "@/lib/zip";
import { buildExportPack } from "@/domains/paperwork/records";
import { makeSixDigitCode } from "@/domains/security/second-step-rules";
import { textCodesReady } from "@/domains/security/second-step";
import { VaultError } from "./unlock";
import { pdfSafeText, wrapPdfText } from "./rules";
import { pauseChargesForEmergencyContact } from "@/domains/continuity/actions";

/**
 * VAULT-2: emergency access (spec §7) — designed in full, shipped OFF.
 *
 * The owner saves an emergency contact and turns the feature on, then issues
 * a link (only its SHA-256 hash is stored) and hands it to the contact. The
 * contact requests access from the public page; the wait starts; the owner
 * is reminded by email and text at the start, halfway and a day before the
 * wait ends, and can deny at any time. After the wait, a one-time code goes
 * to the SAVED contact (never to an address typed on the page); the right
 * code opens a single read-only export — the business records pack plus the
 * vault as a PDF — through a one-time link that dies 24 hours after the
 * code is confirmed and is consumed by its first successful download.
 */

export type EmergencySettings = {
  enabled: boolean;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  waitDays: number;
};

export type EmergencySettingsInput = EmergencySettings;

const SETTINGS_SELECT = {
  emergencyAccessEnabled: true,
  emergencyContactName: true,
  emergencyContactEmail: true,
  emergencyContactPhone: true,
  emergencyWaitDays: true,
} as const;

export async function getEmergencySettings(): Promise<EmergencySettings> {
  const row = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: SETTINGS_SELECT });
  return {
    enabled: row?.emergencyAccessEnabled === true,
    contactName: row?.emergencyContactName ?? "",
    contactEmail: row?.emergencyContactEmail ?? "",
    contactPhone: row?.emergencyContactPhone ?? "",
    waitDays: row?.emergencyWaitDays ?? 7,
  };
}

export async function updateEmergencySettings(userId: string, input: EmergencySettingsInput): Promise<void> {
  const waitDays = Math.trunc(input.waitDays);
  if (!Number.isFinite(waitDays) || waitDays < 1 || waitDays > 30) {
    throw new VaultError("The wait must be between 1 and 30 days.");
  }
  const name = input.contactName.trim();
  const email = input.contactEmail.trim();
  const phone = input.contactPhone.trim();
  if (input.enabled && !name) throw new VaultError("Name the emergency contact before turning emergency access on.");
  if (input.enabled && !email && !phone) {
    throw new VaultError("The emergency contact needs an email or a phone — the one-time code is sent to one of them.");
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new VaultError("That email address doesn't look right.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    await tx.businessSettings.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        emergencyAccessEnabled: input.enabled,
        emergencyContactName: name || null,
        emergencyContactEmail: email || null,
        emergencyContactPhone: phone || null,
        emergencyWaitDays: waitDays,
      },
      update: {
        emergencyAccessEnabled: input.enabled,
        emergencyContactName: name || null,
        emergencyContactEmail: email || null,
        emergencyContactPhone: phone || null,
        emergencyWaitDays: waitDays,
      },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: input.enabled ? "vault.emergency_settings" : "vault.emergency_off",
        entityType: "BusinessSettings",
        entityId: "singleton",
        newValue: { enabled: input.enabled, waitDays },
      },
    });
  });
}

// ---- The link + request lifecycle ----

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const hashCode = (requestId: string, code: string) => createHash("sha256").update(`${requestId}:${code}`).digest("hex");

const NON_TERMINAL = ["LINK_READY", "WAITING", "CODE_SENT", "VERIFIED"] as const;

export type EmergencyOwnerView = {
  settings: EmergencySettings;
  active: {
    id: string;
    status: string;
    contactName: string | null;
    requestedAt: string | null;
    waitEndsAt: string | null;
    downloadedAt: string | null;
    startNoticeFailed: boolean;
    /** A downloaded link can still pause charges until its 24 hours end; the owner can close that early. */
    pauseOpen: boolean;
  } | null;
};

export async function getEmergencyOwnerView(userId: string): Promise<EmergencyOwnerView> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, archivedAt: true } });
  if (!user || user.archivedAt || user.role !== "OWNER") throw new VaultError("That page is owner-only.");
  const [settings, active] = await Promise.all([
    getEmergencySettings(),
    prisma.emergencyAccessRequest.findFirst({
      where: { status: { in: [...NON_TERMINAL, "DENIED", "CONSUMED"] } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return {
    settings,
    active: active
      ? {
          id: active.id,
          status: active.status,
          contactName: active.contactName,
          requestedAt: active.requestedAt?.toISOString() ?? null,
          waitEndsAt: active.waitEndsAt?.toISOString() ?? null,
          downloadedAt: active.downloadedAt?.toISOString() ?? null,
          startNoticeFailed: active.startNoticeFailedAt != null,
          pauseOpen: pauseWindowOpen(active, new Date()),
        }
      : null,
  };
}

/** Issues a fresh link. Any earlier unfinished link or request is superseded. Returns the token ONCE. */
export async function createEmergencyLink(userId: string): Promise<{ token: string }> {
  const settings = await getEmergencySettings();
  if (!settings.enabled) throw new VaultError("Turn emergency access on and save the contact first.");
  if (!settings.contactName || (!settings.contactEmail && !settings.contactPhone)) {
    throw new VaultError("Save the emergency contact's name and an email or phone first.");
  }
  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    await tx.emergencyAccessRequest.updateMany({
      where: { status: { in: [...NON_TERMINAL] } },
      data: { status: "SUPERSEDED" },
    });
    // A downloaded link keeps one power for its 24 hours (pausing charges); replacing the link takes that away too.
    await tx.emergencyAccessRequest.updateMany({
      where: { status: "CONSUMED", exportExpiresAt: { gt: new Date() } },
      data: { exportExpiresAt: new Date() },
    });
    await tx.emergencyAccessRequest.create({
      data: {
        tokenHash: hashToken(token),
        status: "LINK_READY",
        contactName: settings.contactName,
        contactEmail: settings.contactEmail || null,
        contactPhone: settings.contactPhone || null,
      },
    });
    await tx.auditLog.create({
      data: { userId, action: "vault.emergency_link_created", entityType: "EmergencyAccess", entityId: "link", newValue: {} },
    });
  });
  return { token };
}

export async function denyEmergencyRequest(userId: string, requestId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const locked = await tx.$queryRaw<{ status: string; exportExpiresAt: Date | null }[]>`SELECT "status", "exportExpiresAt" FROM "EmergencyAccessRequest" WHERE "id" = ${requestId} FOR UPDATE`;
    const row = locked[0];
    if (!row) throw new VaultError("That request no longer exists.");
    if (pauseWindowOpen(row, new Date()) && row.status === "CONSUMED") {
      // Already downloaded: nothing left to deny except the pause power, which ends now.
      await tx.emergencyAccessRequest.update({ where: { id: requestId }, data: { exportExpiresAt: new Date() } });
      await tx.auditLog.create({
        data: { userId, action: "vault.emergency_denied", entityType: "EmergencyAccess", entityId: requestId, newValue: { afterDownload: true } },
      });
      return;
    }
    if (!["WAITING", "CODE_SENT", "VERIFIED"].includes(row.status)) {
      throw new VaultError("That request can't be denied now.");
    }
    await tx.emergencyAccessRequest.update({ where: { id: requestId }, data: { status: "DENIED", deniedAt: new Date(), codeHash: null, codeExpiresAt: null } });
    await tx.auditLog.create({
      data: { userId, action: "vault.emergency_denied", entityType: "EmergencyAccess", entityId: requestId, newValue: {} },
    });
  });
}

// ---- Owner notifications (two channels) ----

async function ownerContact(): Promise<{ id: string; email: string; phone: string | null; phoneConfirmed: boolean } | null> {
  const owner = await prisma.user.findFirst({
    where: { role: "OWNER", archivedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, phone: true, phoneConfirmedAt: true },
  });
  if (!owner) return null;
  return { id: owner.id, email: owner.email, phone: owner.phone, phoneConfirmed: Boolean(owner.phone && owner.phoneConfirmedAt) };
}

/** Sends one reminder on every channel that works. Returns how many channels carried it. */
async function remindOwner(subject: string, text: string): Promise<number> {
  const owner = await ownerContact();
  if (!owner) return 0;
  let channels = 0;
  const email = await sendEmail({ to: owner.email, subject, text });
  if (email.sent) channels += 1;
  if (owner.phone && owner.phoneConfirmed && (await textCodesReady())) {
    const sms = await sendSms({ to: owner.phone, body: `Robinson Appliance Rentals: ${text}`, purpose: "security" });
    if (sms.outcome === "SENT") channels += 1;
  }
  return channels;
}

function denverDate(date: Date): string {
  return date.toLocaleDateString("en-US", { timeZone: "America/Denver", weekday: "long", month: "long", day: "numeric" });
}

// ---- The public flow (no session; the token is the credential) ----

export type PublicEmergencyState =
  | { state: "inactive" }
  | { state: "ready"; contactName: string }
  | { state: "waiting"; contactName: string; waitEndsAt: string; ownerNoticeFailed: boolean }
  | { state: "denied" }
  | { state: "ready_for_code"; contactName: string }
  | { state: "code_sent"; contactName: string }
  | { state: "verified"; contactName: string; exportExpiresAt: string; chargesPaused: boolean }
  | { state: "consumed"; canPause: boolean; chargesPaused: boolean }
  | { state: "expired" };

type RequestRow = NonNullable<Awaited<ReturnType<typeof findByToken>>>;
async function findByToken(token: string) {
  if (!token || token.length > 200) return null;
  return prisma.emergencyAccessRequest.findUnique({ where: { tokenHash: hashToken(token) } });
}

/** The contact may pause charges while the 24-hour window after the code is open, even after the one download. */
function pauseWindowOpen(row: { status: string; exportExpiresAt: Date | null }, now: Date): boolean {
  return (row.status === "VERIFIED" || row.status === "CONSUMED") && row.exportExpiresAt !== null && now < row.exportExpiresAt; // strictly before: closing a link stamps "now", and the same millisecond must already count as closed
}

function publicState(row: RequestRow, settings: EmergencySettings, now: Date, chargesPaused = false): PublicEmergencyState {
  if (!settings.enabled) return { state: "inactive" };
  const name = row.contactName ?? "the emergency contact";
  switch (row.status) {
    case "LINK_READY":
      return { state: "ready", contactName: name };
    case "WAITING":
      if (row.waitEndsAt && now >= row.waitEndsAt) return { state: "ready_for_code", contactName: name };
      return { state: "waiting", contactName: name, waitEndsAt: row.waitEndsAt?.toISOString() ?? "", ownerNoticeFailed: row.startNoticeFailedAt != null };
    case "CODE_SENT":
      return { state: "code_sent", contactName: name };
    case "VERIFIED":
      if (row.exportExpiresAt && now > row.exportExpiresAt) return { state: "expired" };
      return { state: "verified", contactName: name, exportExpiresAt: row.exportExpiresAt?.toISOString() ?? "", chargesPaused };
    case "DENIED":
      return { state: "denied" };
    case "CONSUMED":
      return { state: "consumed", canPause: pauseWindowOpen(row, now), chargesPaused };
    default:
      return { state: "inactive" };
  }
}

export async function getPublicEmergencyState(token: string, now = new Date()): Promise<PublicEmergencyState> {
  const row = await findByToken(token);
  if (!row) return { state: "inactive" };
  const settings = await getEmergencySettings();
  const paused = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { chargesPausedAt: true } });
  return publicState(row, settings, now, paused?.chargesPausedAt != null);
}

/**
 * OPS-8: the contact's "Pause all automatic charges". Needs the same proof as the download (a verified code, inside
 * the 24-hour window) and the feature still switched on. It only stops new charges, late fees and reminders; it never
 * refunds or cancels, and only the owner can turn charges back on. The owner is told by email and text.
 */
export async function pauseChargesAsContact(token: string, now = new Date()): Promise<{ changed: boolean; ownerNotified: boolean }> {
  const row = await findByToken(token);
  const settings = await getEmergencySettings();
  const refused = "This link can't pause charges. Confirm a code first, or contact the owner.";
  if (!row || !settings.enabled || !pauseWindowOpen(row, now)) throw new VaultError(refused);
  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ status: string; exportExpiresAt: Date | null }[]>`SELECT "status", "exportExpiresAt" FROM "EmergencyAccessRequest" WHERE "id" = ${row.id} FOR UPDATE`;
    if (!locked[0] || !pauseWindowOpen(locked[0], now)) throw new VaultError(refused);
    // One pause per link: if the owner already turned charges back on, this link does not get to pause them again.
    const usedBefore = await tx.auditLog.count({ where: { action: "continuity.charges_paused_emergency", entityId: row.id } });
    if (usedBefore > 0) {
      const current = await tx.businessSettings.findUnique({ where: { id: "singleton" }, select: { chargesPausedAt: true } });
      if (!current?.chargesPausedAt) {
        throw new VaultError("This link already paused charges once, and the owner has turned them back on. Contact the owner.");
      }
      return { changed: false };
    }
    return pauseChargesForEmergencyContact(tx, { requestId: row.id, contactName: row.contactName }, now);
  });

  // Tell the owner on every working channel, and keep an honest record of whether anyone was reached. A failed
  // notice keeps the pause (the high To do item shows it) and is retried the next time the contact presses again.
  const told = await prisma.auditLog.count({ where: { action: "continuity.charges_paused_owner_told", entityId: row.id } });
  let ownerNotified = told > 0;
  if (!ownerNotified) {
    let channels = 0;
    try {
      channels = await remindOwner(
        "Automatic charges were paused",
        `${row.contactName ?? "Your emergency contact"} paused all automatic charges through emergency access. Nothing was refunded or cancelled. Turn charges back on from More > If something happens to me.`,
      );
    } catch {
      channels = 0;
    }
    ownerNotified = channels > 0;
    await prisma.auditLog.create({
      data: {
        action: ownerNotified ? "continuity.charges_paused_owner_told" : "continuity.charges_paused_notice_failed",
        entityType: "EmergencyAccess", entityId: row.id, newValue: { channels },
      },
    });
  }
  return { changed: result.changed, ownerNotified };
}

export async function requestEmergencyAccess(token: string, now = new Date()): Promise<{ ownerNotified: boolean }> {
  const settings = await getEmergencySettings();
  if (!settings.enabled) throw new VaultError("Emergency access is not switched on.");
  const startedId = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; status: string }[]>`SELECT "id", "status" FROM "EmergencyAccessRequest" WHERE "tokenHash" = ${hashToken(token)} FOR UPDATE`;
    const row = rows[0];
    if (!row || row.status !== "LINK_READY") return null;
    const waitEndsAt = new Date(now.getTime() + settings.waitDays * 86_400_000);
    await tx.emergencyAccessRequest.update({
      where: { id: row.id },
      data: { status: "WAITING", requestedAt: now, waitEndsAt },
    });
    await tx.auditLog.create({
      data: { action: "vault.emergency_requested", entityType: "EmergencyAccess", entityId: row.id, newValue: { waitEndsAt: waitEndsAt.toISOString() } },
    });
    return row.id;
  });
  if (!startedId) throw new VaultError("This link is no longer waiting for a request.");
  // The start warning is the security-critical one: its delivery result is
  // CHECKED (never assumed). If no channel carried it, the failure is
  // stamped on the request — visible on the owner's vault page — and the
  // daily sweep keeps retrying until one channel gets through.
  const channels = await remindOwner(
    "Emergency access was requested",
    `${settings.contactName} just used the emergency link and asked for access to the business records and logins. Unless you deny it in the app (More → Logins vault), they can download a read-only export after the wait ends on ${denverDate(new Date(now.getTime() + settings.waitDays * 86_400_000))}. If you don't know why they asked, deny it now.`,
  );
  if (channels === 0) {
    await prisma.$transaction([
      prisma.emergencyAccessRequest.update({ where: { id: startedId }, data: { startNoticeFailedAt: now } }),
      prisma.auditLog.create({
        data: { action: "vault.emergency_notice_failed", entityType: "EmergencyAccess", entityId: startedId, newValue: { round: "start" } },
      }),
    ]);
    return { ownerNotified: false };
  }
  return { ownerNotified: true };
}

/** Sends (or resends) the one-time code to the SAVED contact — phone first, email as the fallback. */
export async function sendEmergencyCode(token: string, now = new Date()): Promise<{ channel: "text" | "email" }> {
  const row = await findByToken(token);
  const settings = await getEmergencySettings();
  if (!row || !settings.enabled) throw new VaultError("This link isn't active.");
  const state = publicState(row, settings, now);
  if (state.state !== "ready_for_code" && state.state !== "code_sent") {
    throw new VaultError("The wait hasn't finished yet.");
  }
  if (row.codeSentAt && now.getTime() - row.codeSentAt.getTime() < 60_000) {
    throw new VaultError("Wait a minute before asking for another code.");
  }
  const code = makeSixDigitCode((max) => randomInt(max));
  let channel: "text" | "email" | null = null;
  // purpose "security" bypasses the customer-texting gate in the SMS sender,
  // whose contract makes the CALLER honour the owner's security-texting
  // switch — the same check remindOwner makes. Switch off means email only.
  if (row.contactPhone && (await textCodesReady())) {
    const sms = await sendSms({
      to: row.contactPhone,
      body: `Robinson Appliance Rentals emergency access: your one-time code is ${code}. It works for 15 minutes.`,
      purpose: "security",
    });
    if (sms.outcome === "SENT") channel = "text";
  }
  if (!channel && row.contactEmail) {
    const email = await sendEmail({
      to: row.contactEmail,
      subject: "Your emergency access code",
      text: `Your one-time code for the Robinson Appliance Rentals emergency export is ${code}. It works for 15 minutes.`,
    });
    if (email.sent) channel = "email";
  }
  if (!channel) {
    throw new VaultError("We couldn't send the code to the saved contact details. Tell the owner to check the texting and email setup.");
  }
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "EmergencyAccessRequest" WHERE "id" = ${row.id} FOR UPDATE`;
    if (!locked[0] || !["WAITING", "CODE_SENT"].includes(locked[0].status)) {
      throw new VaultError("This request changed while the code was sending. Start again.");
    }
    await tx.emergencyAccessRequest.update({
      where: { id: row.id },
      data: {
        status: "CODE_SENT",
        codeHash: hashCode(row.id, code),
        codeExpiresAt: new Date(now.getTime() + 15 * 60_000),
        codeAttempts: 0,
        codeSentAt: now,
      },
    });
    await tx.auditLog.create({
      data: { action: "vault.emergency_code_sent", entityType: "EmergencyAccess", entityId: row.id, newValue: { channel } },
    });
  });
  return { channel };
}

export async function confirmEmergencyCode(token: string, code: string, now = new Date()): Promise<void> {
  const row = await findByToken(token);
  const settings = await getEmergencySettings();
  if (!row || !settings.enabled || row.status !== "CODE_SENT" || !row.codeHash || !row.codeExpiresAt) {
    throw new VaultError("Ask for a code first.");
  }
  if (now > row.codeExpiresAt) throw new VaultError("That code has expired. Ask for a new one.");
  const expected = Buffer.from(row.codeHash, "hex");
  const actual = Buffer.from(hashCode(row.id, code.trim()), "hex");
  const matches = expected.length === actual.length && timingSafeEqual(expected, actual);
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ status: string; codeAttempts: number }[]>`SELECT "status", "codeAttempts" FROM "EmergencyAccessRequest" WHERE "id" = ${row.id} FOR UPDATE`;
    const fresh = locked[0];
    if (!fresh || fresh.status !== "CODE_SENT") throw new VaultError("This request changed. Start again.");
    if (!matches) {
      const attempts = fresh.codeAttempts + 1;
      await tx.emergencyAccessRequest.update({
        where: { id: row.id },
        data:
          attempts >= 5
            ? { codeAttempts: attempts, codeHash: null, codeExpiresAt: null, status: "WAITING" }
            : { codeAttempts: attempts },
      });
      await tx.auditLog.create({
        data: { action: "vault.emergency_code_failed", entityType: "EmergencyAccess", entityId: row.id, newValue: { attempts } },
      });
      return;
    }
    await tx.emergencyAccessRequest.update({
      where: { id: row.id },
      data: {
        status: "VERIFIED",
        codeHash: null,
        codeExpiresAt: null,
        exportExpiresAt: new Date(now.getTime() + 24 * 3_600_000),
      },
    });
    await tx.auditLog.create({
      data: { action: "vault.emergency_code_confirmed", entityType: "EmergencyAccess", entityId: row.id, newValue: {} },
    });
  });
  if (!matches) throw new VaultError("That code was not accepted.");
}

/** Builds the one-time export and consumes the link. The ONLY place the whole vault is decrypted. */
export async function downloadEmergencyExport(
  token: string,
  now = new Date(),
): Promise<{ fileName: string; bytes: Uint8Array }> {
  const row = await findByToken(token);
  const settings = await getEmergencySettings();
  if (!row || !settings.enabled || row.status !== "VERIFIED") {
    throw new VaultError("This download link isn't active.");
  }
  if (!row.exportExpiresAt || now > row.exportExpiresAt) {
    throw new VaultError("This download link has expired.");
  }
  if (!hasVaultCryptoKey()) {
    throw new VaultError("The vault encryption key is missing, so the export can't be prepared. Tell the owner.");
  }
  const owner = await ownerContact();
  if (!owner) throw new VaultError("The export can't be prepared right now.");

  const [records, credentials] = await Promise.all([
    prisma.businessPaperwork.findMany({ select: { id: true } }),
    prisma.vaultCredential.findMany({ orderBy: { title: "asc" } }),
  ]);
  // The records pack needs at least one record; a business with none still
  // gets its logins, with the gap stated in the READ-ME instead of failing.
  const recordsPack =
    records.length > 0 ? await buildExportPack(owner.id, records.map((r) => r.id)) : null;
  const vaultPdf = await buildVaultPdf(credentials, now);

  const bytes = createZip([
    { name: "logins-vault.pdf", data: vaultPdf },
    { name: "logins.txt", data: new TextEncoder().encode(buildVaultText(credentials, now)) },
    ...(recordsPack ? [{ name: recordsPack.fileName, data: recordsPack.bytes }] : []),
    {
      name: "READ-ME.txt",
      data: new TextEncoder().encode(
        [
          "Emergency export for Robinson Appliance Rentals.",
          `Prepared ${now.toISOString()} for the owner's emergency contact after the waiting period.`,
          recordsPack
            ? "logins-vault.pdf lists every saved business login, and logins.txt has the same logins in plain text, exactly as saved. The records file is the business records export (index plus attachments)."
            : "logins-vault.pdf lists every saved business login, and logins.txt has the same logins in plain text, exactly as saved. No business records were on file, so there is no records file in this export.",
          "This export was generated once, under the owner's emergency-access settings, and the download was recorded in the app's activity log.",
        ].join("\n"),
      ),
    },
  ]);

  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "EmergencyAccessRequest" WHERE "id" = ${row.id} FOR UPDATE`;
    if (!locked[0] || locked[0].status !== "VERIFIED") {
      throw new VaultError("This download link has already been used.");
    }
    await tx.emergencyAccessRequest.update({
      where: { id: row.id },
      data: { status: "CONSUMED", downloadedAt: now },
    });
    await tx.auditLog.create({
      data: {
        userId: owner.id,
        action: "vault.emergency_export",
        entityType: "EmergencyAccess",
        entityId: row.id,
        newValue: { records: records.length, logins: credentials.length },
      },
    });
  });
  return { fileName: "emergency-export.zip", bytes };
}

type CredentialForPdf = {
  title: string;
  url: string | null;
  usernameEncrypted: string | null;
  passwordEncrypted: string | null;
  notesEncrypted: string | null;
  totpHint: string | null;
  lastRotatedOn: Date | null;
};

/** One login's export lines, shared by the PDF and the plain-text copy so the two can never drift apart. */
function credentialLines(c: CredentialForPdf): string[] {
  const lines: string[] = [];
  if (c.url) lines.push(`Website: ${c.url}`);
  if (c.usernameEncrypted) lines.push(`Username: ${decryptVaultField(c.usernameEncrypted)}`);
  if (c.passwordEncrypted) lines.push(`Password: ${decryptVaultField(c.passwordEncrypted)}`);
  if (c.notesEncrypted) lines.push(`Notes: ${decryptVaultField(c.notesEncrypted)}`);
  if (c.totpHint) lines.push(`Second step: ${c.totpHint}`);
  if (c.lastRotatedOn) lines.push(`Password last changed: ${c.lastRotatedOn.toISOString().slice(0, 10)}`);
  return lines;
}

/**
 * The export's exact copy: a UTF-8 text file where every login survives
 * character for character — repeated spaces, emoji, non-Latin text — while
 * the PDF's fonts can only print part of that range (see pdfSafeText).
 */
function buildVaultText(credentials: CredentialForPdf[], now: Date): string {
  const out = [
    "Business logins — emergency export (plain text)",
    `Prepared ${now.toISOString()}. Keep this file somewhere safe; it contains passwords.`,
    "Every login below is exactly as it was saved.",
    "",
  ];
  if (credentials.length === 0) out.push("No logins were saved in the vault.");
  for (const c of credentials) {
    out.push(c.title, ...credentialLines(c), "");
  }
  return out.join("\n");
}

async function buildVaultPdf(credentials: CredentialForPdf[], now: Date): Promise<Uint8Array> {
  const entries = credentials.map((c) => ({ title: c.title, lines: credentialLines(c) }));
  const pdfLossy = entries.some(
    (e) => pdfSafeText(e.title) !== e.title || e.lines.some((l) => pdfSafeText(l) !== l),
  );
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([612, 792]);
  let y = 740;
  const line = (text: string, size = 10, isBold = false) => {
    // wrapPdfText is character-exact (a long secret is split across lines,
    // never cut) and pdfSafeText keeps every drawn string inside the fonts'
    // character set, so an unusual password can neither be truncated nor
    // sink the whole export.
    for (const piece of wrapPdfText(pdfSafeText(text))) {
      if (y < 60) {
        page = doc.addPage([612, 792]);
        y = 740;
      }
      page.drawText(piece, { x: 48, y, size, font: isBold ? bold : font, color: rgb(0.1, 0.1, 0.1) });
      y -= size + 5;
    }
  };
  line("Business logins — emergency export", 15, true);
  line(`Prepared ${now.toISOString()}. Keep this file somewhere safe; it contains passwords.`);
  if (pdfLossy) {
    line(
      "Note: some characters in these logins can't be printed in a PDF and show as ? here. The logins.txt file in this export has every login exactly as saved.",
    );
  }
  y -= 6;
  for (const e of entries) {
    line(e.title, 12, true);
    for (const l of e.lines) line(l);
    y -= 8;
  }
  if (entries.length === 0) line("No logins were saved in the vault.");
  return doc.save();
}

// ---- The reminder sweep (daily cron) ----

export async function runEmergencyReminders(now = new Date()): Promise<{ reminded: number }> {
  const settings = await getEmergencySettings();
  if (!settings.enabled) return { reminded: 0 };
  const waiting = await prisma.emergencyAccessRequest.findMany({
    where: { status: "WAITING", requestedAt: { not: null }, waitEndsAt: { not: null, gt: now } },
  });
  let reminded = 0;
  for (const row of waiting) {
    const requestedAt = row.requestedAt!;
    const waitEndsAt = row.waitEndsAt!;
    if (row.startNoticeFailedAt) {
      const channels = await remindOwner(
        "Emergency access was requested",
        `${row.contactName ?? "Your emergency contact"} used the emergency link and asked for access to the business records and logins. (This warning did not get through when the request started; the app is retrying.) Unless you deny it in the app (More → Logins vault), they can download a read-only export after the wait ends on ${denverDate(waitEndsAt)}. If you don't know why they asked, deny it now.`,
      );
      if (channels > 0) {
        await prisma.emergencyAccessRequest.update({ where: { id: row.id }, data: { startNoticeFailedAt: null } });
        row.startNoticeFailedAt = null;
        reminded += 1;
      }
    }
    const dayBeforeAt = new Date(waitEndsAt.getTime() - 24 * 3_600_000);
    const halfwayAt = new Date(requestedAt.getTime() + (waitEndsAt.getTime() - requestedAt.getTime()) / 2);
    if (!row.remindedDayBeforeAt && now >= dayBeforeAt) {
      const channels = await remindOwner(
        "Emergency access: one day left to deny",
        `${row.contactName ?? "Your emergency contact"} asked for emergency access, and the wait ends tomorrow (${denverDate(waitEndsAt)}). After that they can confirm a code and download the records and logins export. To stop it, deny the request in the app (More → Logins vault).`,
      );
      if (channels > 0) {
        await prisma.emergencyAccessRequest.update({
          where: { id: row.id },
          data: { remindedDayBeforeAt: now, remindedHalfwayAt: row.remindedHalfwayAt ?? now },
        });
        reminded += 1;
      }
    } else if (!row.remindedHalfwayAt && now >= halfwayAt) {
      const channels = await remindOwner(
        "Emergency access: halfway through the wait",
        `${row.contactName ?? "Your emergency contact"} asked for emergency access. The wait ends on ${denverDate(waitEndsAt)}. To stop it, deny the request in the app (More → Logins vault).`,
      );
      if (channels > 0) {
        await prisma.emergencyAccessRequest.update({ where: { id: row.id }, data: { remindedHalfwayAt: now } });
        reminded += 1;
      }
    }
  }
  return { reminded };
}
