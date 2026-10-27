"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { createW9Request, recordSupplierTin, setBackupWithholding } from "@/domains/compliance/w9";
import { sendEmail } from "@/lib/email";

/**
 * CMP-3: W-9 actions on the supplier screen. The one-time link is shown
 * to the owner (and emailed when the supplier has an address on file);
 * the token itself is never stored — only its hash.
 */

export type W9ActionState = { error?: string; ok?: boolean; link?: string; emailed?: boolean };

const message = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Try again.";

export async function requestW9Action(supplierId: string): Promise<W9ActionState> {
  try {
    const { user } = await requireRole("OWNER", "ADMIN");
    const { token } = await createW9Request(user.id, supplierId);
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    const link = `${base}/w9/${token}`;
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { email: true, name: true },
    });
    let emailed = false;
    if (supplier?.email) {
      const result = await sendEmail({
        to: supplier.email,
        subject: "Please send us your W-9",
        text: `Hello ${supplier.name},\n\nRobinson Appliance Rentals needs a W-9 on file before we can pay you. This one-time link opens a short page where you can type your tax information or upload a completed W-9:\n\n${link}\n\nThe link works once and expires in 14 days. Thank you!`,
        actionLabel: "Open the W-9 page",
        idempotencyKey: `w9-request-${supplierId}-${token.slice(0, 8)}`,
      });
      emailed = result.sent;
    }
    revalidatePath(`/desk/suppliers/${supplierId}`);
    return { ok: true, link, emailed };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function recordTinAction(
  supplierId: string,
  _prev: W9ActionState,
  formData: FormData,
): Promise<W9ActionState> {
  try {
    const { user } = await requireRole("OWNER");
    const tinType = String(formData.get("tinType") ?? "");
    if (tinType !== "SSN" && tinType !== "EIN") return { error: "Choose whether the tax ID is an SSN or an EIN." };
    const street = String(formData.get("mailingAddress") ?? "").trim();
    await recordSupplierTin(user.id, supplierId, {
      legalName: String(formData.get("legalName") ?? ""),
      tinType,
      tin: String(formData.get("tin") ?? ""),
      backupWithholding: formData.get("backupWithholding") === "on",
      ...(street
        ? {
            address: {
              street,
              city: String(formData.get("mailingCity") ?? ""),
              state: String(formData.get("mailingState") ?? ""),
              zip: String(formData.get("mailingZip") ?? ""),
            },
          }
        : {}),
    });
    revalidatePath(`/desk/suppliers/${supplierId}`);
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function setBackupWithholdingAction(supplierId: string, on: boolean): Promise<W9ActionState> {
  try {
    const { user } = await requireRole("OWNER");
    await setBackupWithholding(user.id, supplierId, on);
    revalidatePath(`/desk/suppliers/${supplierId}`);
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}
