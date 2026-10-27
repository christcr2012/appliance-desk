"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { requireRole } from "@/lib/session";
import {
  createCredential,
  deleteCredential,
  linkRecordToCredential,
  markCredentialRotated,
  revealField,
  unlinkRecord,
  updateCredential,
} from "@/domains/vault";
import { vaultCredentialInputSchema } from "@/domains/vault/schema";
import { isVaultField } from "@/domains/vault/rules";
import { grantVaultUnlock, recordFailedVaultUnlock } from "@/domains/vault/unlock";
import {
  createEmergencyLink,
  denyEmergencyRequest,
  updateEmergencySettings,
} from "@/domains/vault/emergency";

export type VaultFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "saved" }
  | { status: "unlocked" }
  | { status: "sent" };

function refresh(credentialId?: string) {
  revalidatePath("/desk/vault");
  if (credentialId) revalidatePath(`/desk/vault/${credentialId}`);
  revalidatePath("/desk/today");
  revalidatePath("/desk/paperwork");
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

// ---- Unlock: a fresh second-step code, verified by Better Auth itself ----

export type UnlockMethod = "totp" | "otp" | "backup";

export async function sendUnlockCodeAction(): Promise<VaultFormState> {
  await requireRole("OWNER");
  try {
    await auth.api.sendTwoFactorOTP({ headers: await headers(), body: {} });
  } catch {
    return { status: "error", message: "We could not send a code. Use your authenticator app or a backup code instead." };
  }
  return { status: "sent" };
}

export async function unlockVaultAction(
  _previous: VaultFormState,
  formData: FormData,
): Promise<VaultFormState> {
  const session = await requireRole("OWNER");
  const method = formData.get("method");
  const code = formData.get("code");
  if (typeof code !== "string" || code.trim() === "") {
    return { status: "error", message: "Type the code first." };
  }
  let verified = false;
  try {
    const hdrs = await headers();
    if (method === "otp") {
      await auth.api.verifyTwoFactorOTP({ headers: hdrs, body: { code: code.trim() } });
      verified = true;
    } else if (method === "backup") {
      await auth.api.verifyBackupCode({ headers: hdrs, body: { code: code.trim() } });
      verified = true;
    } else {
      await auth.api.verifyTOTP({ headers: hdrs, body: { code: code.trim() } });
      verified = true;
    }
  } catch {
    verified = false;
  }
  if (!verified) {
    const status = await recordFailedVaultUnlock(session.user.id).catch(() => null);
    refresh();
    if (status?.locked) {
      return {
        status: "error",
        message: "Too many wrong codes — the vault is locked for 30 minutes. We've emailed you about it.",
      };
    }
    return { status: "error", message: "That code was not accepted. Check it and try again." };
  }
  try {
    await grantVaultUnlock(session.user.id, session.session.id);
  } catch (error) {
    return { status: "error", message: messageOf(error, "The vault could not be unlocked.") };
  }
  refresh();
  return { status: "unlocked" };
}

// ---- Credentials ----

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function credentialInput(formData: FormData) {
  const raw: Record<string, unknown> = {
    title: text(formData, "title"),
    url: text(formData, "url"),
    totpHint: text(formData, "totpHint"),
    rotateEveryMonths: text(formData, "rotateEveryMonths") === "" ? null : Number(text(formData, "rotateEveryMonths")),
  };
  for (const field of ["username", "password", "notes"] as const) {
    if (formData.get(`clear_${field}`) === "on") {
      raw[field] = ""; // explicit clear
    } else {
      const value = text(formData, field);
      if (value !== "") raw[field] = value; // absent = leave alone
    }
  }
  return vaultCredentialInputSchema.parse(raw);
}

export async function createCredentialAction(
  _previous: VaultFormState,
  formData: FormData,
): Promise<VaultFormState> {
  const session = await requireRole("OWNER");
  try {
    const input = credentialInput(formData);
    await createCredential(session.user.id, session.session.id, input);
  } catch (error) {
    return { status: "error", message: messageOf(error, "That login could not be saved.") };
  }
  refresh();
  return { status: "saved" };
}

export async function updateCredentialAction(
  credentialId: string,
  expectedVersion: number,
  _previous: VaultFormState,
  formData: FormData,
): Promise<VaultFormState> {
  const session = await requireRole("OWNER");
  try {
    const input = credentialInput(formData);
    await updateCredential(session.user.id, session.session.id, credentialId, input, expectedVersion);
  } catch (error) {
    return { status: "error", message: messageOf(error, "That login could not be saved.") };
  }
  refresh(credentialId);
  return { status: "saved" };
}

export async function deleteCredentialAction(credentialId: string): Promise<void> {
  const session = await requireRole("OWNER");
  await deleteCredential(session.user.id, credentialId);
  refresh();
}

export async function markRotatedAction(credentialId: string): Promise<void> {
  const session = await requireRole("OWNER");
  await markCredentialRotated(session.user.id, credentialId);
  refresh(credentialId);
}

export async function revealFieldAction(
  credentialId: string,
  field: string,
  purpose: "show" | "copy",
): Promise<{ value: string } | { error: string }> {
  const session = await requireRole("OWNER");
  if (!isVaultField(field)) return { error: "That field can't be shown." };
  try {
    return await revealField(session.user.id, session.session.id, credentialId, field, purpose);
  } catch (error) {
    return { error: messageOf(error, "That value could not be shown.") };
  }
}

// ---- Linking to business records ----

export async function linkRecordAction(
  credentialId: string,
  _previous: VaultFormState,
  formData: FormData,
): Promise<VaultFormState> {
  const session = await requireRole("OWNER");
  const recordId = text(formData, "recordId");
  if (!recordId) return { status: "error", message: "Choose a record first." };
  try {
    await linkRecordToCredential(session.user.id, credentialId, recordId);
  } catch (error) {
    return { status: "error", message: messageOf(error, "That record could not be linked.") };
  }
  refresh(credentialId);
  return { status: "saved" };
}

export async function unlinkRecordAction(recordId: string): Promise<void> {
  const session = await requireRole("OWNER");
  await unlinkRecord(session.user.id, recordId);
  refresh();
}

// ---- Emergency access ----

export async function saveEmergencySettingsAction(
  _previous: VaultFormState,
  formData: FormData,
): Promise<VaultFormState> {
  const session = await requireRole("OWNER");
  try {
    await updateEmergencySettings(session.user.id, {
      enabled: formData.get("enabled") === "on",
      contactName: text(formData, "contactName"),
      contactEmail: text(formData, "contactEmail"),
      contactPhone: text(formData, "contactPhone"),
      waitDays: Number(text(formData, "waitDays") || "7"),
    });
  } catch (error) {
    return { status: "error", message: messageOf(error, "Those settings could not be saved.") };
  }
  refresh();
  return { status: "saved" };
}

export async function createEmergencyLinkAction(): Promise<{ token: string } | { error: string }> {
  const session = await requireRole("OWNER");
  try {
    const { token } = await createEmergencyLink(session.user.id);
    refresh();
    return { token };
  } catch (error) {
    return { error: messageOf(error, "The link could not be created.") };
  }
}

export async function denyEmergencyRequestAction(requestId: string): Promise<void> {
  const session = await requireRole("OWNER");
  await denyEmergencyRequest(session.user.id, requestId);
  refresh();
}
