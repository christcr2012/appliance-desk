"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { chooseCustomerLanguage } from "@/domains/language";

export type LanguageActionResult = { status: "idle" | "success" | "error"; message: "" | "Choose English or Español." | "Customer account unavailable." | "Language preference saved." | "Couldn't save your preference. Try again." };
export async function saveCustomerLanguage(formData: FormData): Promise<LanguageActionResult> {
  const session = await requireSession();
  const language = formData.get("language");
  if (language !== "en" && language !== "es") {
    return { status: "error", message: "Choose English or Español." };
  }
  let updated:boolean;
  try {updated=await chooseCustomerLanguage(session.user.id, language);}
  catch {return {status:"error",message:"Couldn't save your preference. Try again."};}
  if (!updated) return { status: "error", message: "Customer account unavailable." };
  revalidatePath("/account", "layout");
  revalidatePath("/account/settings");
  return { status: "success", message: "Language preference saved." };
}
