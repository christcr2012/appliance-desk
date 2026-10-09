"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { splitOldSetAppliance, SplitApplianceError } from "@/domains/packages/split";

export type SplitState =
  | { status: "idle" }
  | { status: "success"; message: string; created: { id: string; assetNumber: string }[] }
  | { status: "error"; message: string };

const partSchema = z.object({
  applianceTypeId: z.string().min(1),
  manufacturer: z.string().trim().max(100).optional(),
  model: z.string().trim().max(100).optional(),
  serialNumber: z.string().trim().max(100).optional(),
});

/** Splits an old one-record washer + dryer set into its separate machines (W-16B). OWNER/ADMIN. */
export async function splitOldSetApplianceAction(applianceId: string, raw: unknown): Promise<SplitState> {
  const session = await requireRole("OWNER", "ADMIN");
  const parsed = z.array(partSchema).min(2).max(20).safeParse(raw);
  if (!parsed.success) return { status: "error", message: "Check each machine's details, then try again." };
  try {
    const result = await splitOldSetAppliance(session.user.id, applianceId, parsed.data);
    revalidatePath("/desk/inventory");
    revalidatePath(`/desk/inventory/${applianceId}`);
    revalidatePath("/desk/today");
    return {
      status: "success",
      message: `${result.original} is now ${result.created.length + 1} separate machines. Any rental it was on keeps its signed price; the new machine${result.created.length > 1 ? "s are" : " is"} on the same rental.`,
      created: result.created.map((m) => ({ id: m.id, assetNumber: m.assetNumber })),
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof SplitApplianceError || (error instanceof Error && error.message.startsWith("This account"))
          ? error.message
          : "The split was not saved. Nothing changed; reload and try again.",
    };
  }
}
