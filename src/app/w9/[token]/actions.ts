"use server";

import { headers } from "next/headers";
import { isRateLimited } from "@/lib/rate-limit";
import { hashW9Token, storeW9Pdf, submitTypedW9, submitUploadedW9, w9LinkState } from "@/domains/compliance/w9";

/**
 * CMP-3: the public one-time W-9 page's submissions. No account is
 * involved — the link token is the credential, it works once, and every
 * attempt is rate limited by token and by visitor address.
 */

export type W9SubmitState = { error?: string; done?: boolean };

const message = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Try again.";

async function guard(token: string): Promise<void> {
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited =
    (await isRateLimited(`w9-token:${hashW9Token(token)}`, { max: 10, windowMs: 60 * 60 * 1000 })) ||
    (await isRateLimited(`w9-ip:${ip}`, { max: 30, windowMs: 60 * 60 * 1000 }));
  if (limited) throw new Error("Too many tries — wait a bit and try again, or ask us for a new link.");
}

export async function submitTypedAction(
  token: string,
  _prev: W9SubmitState,
  formData: FormData,
): Promise<W9SubmitState> {
  try {
    await guard(token);
    const tinType = String(formData.get("tinType") ?? "");
    if (tinType !== "SSN" && tinType !== "EIN") return { error: "Choose whether your tax ID is an SSN or an EIN." };
    const legalName = String(formData.get("legalName") ?? "");
    const tin = String(formData.get("tin") ?? "");
    // The typed answers also produce the filled official W-9, kept with
    // the supplier's record in the private store — best effort: if file
    // storage is not set up, the answers themselves are still the record.
    let w9FileUrl: string | undefined;
    const state = await w9LinkState(token);
    if (state.ok) {
      try {
        const { fillW9 } = await import("@/domains/compliance/pdf-forms");
        const digits = tin.replace(/[^0-9]/g, "");
        if (digits.length === 9) {
          const bytes = await fillW9({ legalName, tinType, tinDigits: digits });
          w9FileUrl = await storeW9Pdf(state.supplierId, bytes);
        }
      } catch {
        w9FileUrl = undefined;
      }
    }
    await submitTypedW9(token, { legalName, tinType, tin, w9FileUrl });
    return { done: true };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function submitUploadAction(
  token: string,
  _prev: W9SubmitState,
  formData: FormData,
): Promise<W9SubmitState> {
  try {
    await guard(token);
    const state = await w9LinkState(token);
    if (!state.ok) return { error: "This W-9 link is no longer active. Ask us for a new one." };
    const file = formData.get("w9file");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose the signed W-9 PDF to upload." };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileUrl = await storeW9Pdf(state.supplierId, bytes);
    await submitUploadedW9(token, {
      legalName: String(formData.get("legalName") ?? ""),
      fileUrl,
    });
    return { done: true };
  } catch (error) {
    return { error: message(error) };
  }
}
