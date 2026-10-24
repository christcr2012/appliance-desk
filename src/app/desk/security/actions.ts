"use server";

import { revalidatePath } from "next/cache";
import { requireRoleForTwoFactorSetup } from "@/lib/session";
import {
  SecondStepError, chooseSecondStepMethod, confirmMethodSwitch, confirmPhone, startMethodSwitch, startPhoneConfirmation,
  type DeliveryOutcome,
} from "@/domains/security/second-step";

// ACC-3 actions for choosing and proving a second-step method. They work only on the signed-in person's own row.
export type StepResult = { status: "success"; message?: string } | { status: "error"; message: string };

async function run(fn: (userId: string) => Promise<string | undefined>, fallback: string): Promise<StepResult> {
  const session = await requireRoleForTwoFactorSetup("OWNER", "ADMIN", "STAFF");
  try {
    const message = await fn(session.user.id);
    revalidatePath("/desk/account");
    revalidatePath("/desk/security/setup");
    return { status: "success", message };
  } catch (error) {
    return { status: "error", message: error instanceof SecondStepError ? error.message : error instanceof Error && error.message.startsWith("This account no longer") ? error.message : fallback };
  }
}

function sentMessage(outcome: DeliveryOutcome, where: string): string {
  if (outcome === "SENT") return `We sent a code ${where}. It works for 5 minutes.`;
  throw new SecondStepError(`We could not send the code ${where}. Nothing was changed; try again in a minute or choose another method.`);
}

export const chooseMethodAction = (method: string) => run(async (id) => { await chooseSecondStepMethod(id, method); return undefined; }, "Couldn't save that choice.");
export const startPhoneCheckAction = () => run(async (id) => sentMessage(await startPhoneConfirmation(id), "to your phone"), "Couldn't send a code.");
export const confirmPhoneAction = (code: string) => run(async (id) => { await confirmPhone(id, code); return "Phone number checked."; }, "Couldn't check that code.");
export const startSwitchAction = (method: string) => run(async (id) => sentMessage(await startMethodSwitch(id, method), method === "SMS" ? "to your phone" : "to your email"), "Couldn't send a code.");
export const confirmSwitchAction = (method: string, code: string) => run(async (id) => { await confirmMethodSwitch(id, method, code); return "Method changed."; }, "Couldn't change the method.");
