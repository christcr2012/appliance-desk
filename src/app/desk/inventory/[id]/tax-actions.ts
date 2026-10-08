"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { dollarsToCents } from "@/domains/pricing";
import { recordApplianceAcquisitionTax } from "@/domains/tax/acquisition";

const input = z.object({
  choice: z.enum(["SELLER_CHARGED", "NONE_CHARGED", "LESSOR_PERMISSION", "LATER"]),
  vendorTaxDollars: z.number().finite().min(0).max(1_000_000),
  sellerNote: z.string().max(500),
  receiptPhotoId: z.string().optional(),
  expectedRecordedAt: z.string().nullable(),
});

export async function saveAppliancePurchaseTaxAction(
  applianceId: string,
  raw: unknown,
): Promise<{ status: "success" } | { status: "error"; message: string }> {
  const session = await requireRole("OWNER");
  const parsed = input.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the purchase tax details." };
  }
  const { choice, vendorTaxDollars, sellerNote, receiptPhotoId, expectedRecordedAt } = parsed.data;
  const revision = expectedRecordedAt === null ? null : new Date(expectedRecordedAt);
  if (revision && !Number.isFinite(revision.getTime())) {
    return { status: "error", message: "Reload this appliance before saving." };
  }
  try {
    await recordApplianceAcquisitionTax(session.user.id, {
      applianceId,
      choice,
      vendorTaxCents: dollarsToCents(vendorTaxDollars),
      sellerNote,
      ...(receiptPhotoId ? { receiptPhotoId } : {}),
      expectedRecordedAt: revision,
    });
    revalidatePath(`/desk/inventory/${applianceId}`);
    revalidatePath("/desk/inventory");
    revalidatePath("/desk/today");
    return { status: "success" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Could not save purchase tax." };
  }
}
