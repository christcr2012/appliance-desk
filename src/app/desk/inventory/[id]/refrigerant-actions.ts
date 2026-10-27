"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { saveRefrigerantRecord } from "@/domains/refrigerant/actions";
import type { RefrigerantOutcomeName } from "@/domains/refrigerant/rules";

export type RefrigerantActionState = { status: "idle" } | { status: "success"; message: string } | { status: "error"; message: string };

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "");

export async function saveRefrigerantAction(applianceId: string, _: RefrigerantActionState, fd: FormData): Promise<RefrigerantActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await saveRefrigerantRecord(session.user.id, applianceId, {
      refrigerantType: text(fd, "refrigerantType"),
      outcome: text(fd, "outcome") as RefrigerantOutcomeName,
      recoveredByName: text(fd, "recoveredByName"),
      recoveredByAddress: text(fd, "recoveredByAddress"),
      certificationNumber: text(fd, "certificationNumber"),
      equipmentUsed: text(fd, "equipmentUsed"),
      recoveredOnKey: text(fd, "recoveredOn"),
      recyclerName: text(fd, "recyclerName"),
      receiptReference: text(fd, "receiptReference"),
      certify: fd.get("certify") === "on",
    });
    revalidatePath(`/desk/inventory/${applianceId}`);
    revalidatePath("/desk/inventory/retired");
    return { status: "success", message: "Saved and signed. You can print the statement for the scrap yard." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't save that." };
  }
}
