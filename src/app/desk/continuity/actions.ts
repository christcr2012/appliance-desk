"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { completeYearlyCheckup, saveContinuityProfile, setChargesPaused } from "@/domains/continuity/actions";
import { PROFILE_FIELDS, type ProfileKey } from "@/domains/continuity/rules";

export type ContinuityState = { status: "idle" } | { status: "success"; message: string } | { status: "error"; message: string };

const fail = (error: unknown): ContinuityState => ({ status: "error", message: error instanceof Error ? error.message : "Couldn't save that." });
const text = (fd: FormData, key: string) => String(fd.get(key) ?? "");
const refresh = () => { revalidatePath("/desk/continuity"); revalidatePath("/desk/continuity/checkup"); revalidatePath("/desk/today"); revalidatePath("/desk/tasks"); revalidatePath("/desk/automations"); };

export async function saveProfileAction(_: ContinuityState, fd: FormData): Promise<ContinuityState> {
  const session = await requireRole("OWNER");
  try {
    const input: Partial<Record<ProfileKey, string>> = {};
    for (const f of PROFILE_FIELDS) input[f.key] = text(fd, f.key);
    await saveContinuityProfile(session.user.id, input);
    refresh();
    return { status: "success", message: "Saved." };
  } catch (error) { return fail(error); }
}

export async function pauseChargesAction(paused: boolean, _: ContinuityState, fd: FormData): Promise<ContinuityState> {
  const session = await requireRole("OWNER");
  try {
    const result = await setChargesPaused(session.user.id, paused, text(fd, "note"));
    refresh();
    if (!result.changed) return { status: "success", message: paused ? "Charges were already paused." : "Charges were already on." };
    return { status: "success", message: paused ? "Paused. New automatic charges and reminders are on hold. Nothing was refunded or cancelled." : "Turned back on. The nightly jobs run again tomorrow." };
  } catch (error) { return fail(error); }
}

export async function completeCheckupAction(_: ContinuityState, fd: FormData): Promise<ContinuityState> {
  const session = await requireRole("OWNER");
  try {
    const { year } = await completeYearlyCheckup(session.user.id, fd.getAll("ticked").map(String), text(fd, "note"));
    refresh();
    return { status: "success", message: `Your ${year} check-up is saved. It will not come back until next December.` };
  } catch (error) { return fail(error); }
}
