"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { chooseCustomerLanguage } from "@/domains/language";

export type LanguageActionResult = { status: "idle" | "success" | "error"; message: string };
export async function saveCustomerLanguage(formData: FormData): Promise<LanguageActionResult> {
  const session = await requireSession();
  const language = formData.get("language");
  if (language !== "en" && language !== "es") {
    return { status: "error", message: "Choose English or Español." };
  }
  const updated = await chooseCustomerLanguage(session.user.id, language);
  if (!updated) return { status: "error", message: "Customer account unavailable." };
  revalidatePath("/account", "layout");
  revalidatePath("/account/settings");
  return { status: "success", message: "Language preference saved." };
}
