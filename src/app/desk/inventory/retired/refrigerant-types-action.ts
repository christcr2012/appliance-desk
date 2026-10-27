"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { saveRefrigerantTypes } from "@/domains/refrigerant/actions";

export async function saveRefrigerantTypesAction(formData: FormData): Promise<void> {
  const session = await requireRole("OWNER");
  await saveRefrigerantTypes(session.user.id, formData.getAll("typeId").map(String));
  revalidatePath("/desk/inventory/retired");
}
