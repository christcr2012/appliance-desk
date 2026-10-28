"use server";

import { revalidatePath } from "next/cache";

import { personalShareAccounts, saveWriteOffSettings } from "@/domains/taxben/classification";
import { bonusClassOptions, saveBonusElectOut } from "@/domains/taxben/elections";
import { signCapitalizationPolicy } from "@/domains/taxben/policy";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import type { TaxActionState } from "../setup/actions";

function fail(error: unknown): TaxActionState {
  const raw = error instanceof Error ? error.message : "";
  return {
    success: "",
    error: /failed|changed|already|only|missing|invalid|cannot/i.test(raw)
      ? raw.slice(0, 250)
      : "The policy couldn't be signed. Refresh and try again.",
  };
}

export async function signPolicyAction(
  _state: TaxActionState,
  form: FormData,
): Promise<TaxActionState> {
  const session = await requireRole("OWNER");
  const year = Number(form.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return { success: "", error: "That year couldn't be read." };
  }
  try {
    await signCapitalizationPolicy(session.user.id, year);
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/desk/sales-tax/benefits");
  revalidatePath("/desk");
  return { success: `The ${year} capitalization policy is signed and stored in Business records.`, error: "" };
}

export async function saveWriteOffSettingsAction(
  _state: TaxActionState,
  form: FormData,
): Promise<TaxActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  const percents: Record<string, number> = {};
  for (const account of personalShareAccounts()) {
    const raw = form.get(`percent_${account.role}`);
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      return { success: "", error: `The business-use share for ${account.name} must be a whole number from 0 to 100.` };
    }
    percents[account.role] = value;
  }
  const zone = form.get("enterpriseZone");
  const preference = form.get("capitalizationPreference");
  const electionYear = Number(form.get("deMinimisYear"));
  try {
    await saveWriteOffSettings(session.user.id, {
      businessUsePercents: percents,
      enterpriseZone: zone === "YES" || zone === "NO" || zone === "UNKNOWN" ? zone : undefined,
      capitalizationPreference: preference === "BONUS" || preference === "SECTION179" ? preference : undefined,
      deMinimisElection: Number.isInteger(electionYear)
        ? { year: electionYear, on: form.get("deMinimisOn") === "on" }
        : undefined,
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/desk/sales-tax/benefits");
  revalidatePath("/desk");
  return { success: "Your write-off settings are saved.", error: "" };
}

export async function saveElectionsAction(
  _state: TaxActionState,
  form: FormData,
): Promise<TaxActionState> {
  const session = await requireRole("OWNER", "ADMIN", "ACCOUNTANT");
  const year = Number(form.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return { success: "", error: "That year couldn't be read." };
  }
  try {
    const options = await bonusClassOptions(prisma, year);
    const classes = options
      .filter((option) => form.get(`electOut_${option.key}`) === "on")
      .map((option) => option.key);
    await saveBonusElectOut(session.user.id, year, classes);
  } catch (error) {
    const raw = error instanceof Error ? error.message : "";
    return {
      success: "",
      error: /failed|changed|already|only|missing|invalid|cannot|not in the rule book/i.test(raw)
        ? raw.slice(0, 250)
        : "The elections couldn't be saved. Refresh and try again.",
    };
  }
  revalidatePath("/desk/sales-tax/benefits");
  revalidatePath("/desk");
  return { success: `The ${year} elections are saved. The change is listed for the owner.`, error: "" };
}
