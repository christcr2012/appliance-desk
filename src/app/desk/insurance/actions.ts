"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { parseDollarInput } from "@/lib/money-ui";
import { archivePolicy, keepCertificateOnRecord, requestCertificate, savePolicy, saveReminderDays, saveWorkersComp } from "@/domains/insurance/actions";
import { REMIND_FIRST_DEFAULT, REMIND_SECOND_DEFAULT, type InsuranceKindValue, type WorkersCompStatusValue } from "@/domains/insurance/rules";

export type InsuranceActionState =
  | { status: "idle" }
  | { status: "success"; message: string; mailto?: string }
  | { status: "error"; message: string };

const fail = (error: unknown): InsuranceActionState => ({ status: "error", message: error instanceof Error ? error.message : "Couldn't save that." });
const text = (fd: FormData, key: string) => String(fd.get(key) ?? "");
const refresh = () => { revalidatePath("/desk/insurance"); revalidatePath("/desk/today"); revalidatePath("/desk/tasks"); };

export async function savePolicyAction(policyId: string | null, _: InsuranceActionState, fd: FormData): Promise<InsuranceActionState> {
  const session = await requireRole("OWNER");
  try {
    const premium = text(fd, "premium").trim();
    await savePolicy(session.user.id, policyId, {
      kind: text(fd, "kind") as InsuranceKindValue, insurer: text(fd, "insurer"), policyNumber: text(fd, "policyNumber"), limitsText: text(fd, "limits"),
      annualPremiumCents: premium ? parseDollarInput(premium, 100_000_000) : null, effectiveOnKey: text(fd, "effectiveOn"), expiresOnKey: text(fd, "expiresOn"),
      agentName: text(fd, "agentName"), agentEmail: text(fd, "agentEmail"), certificateNote: text(fd, "certificateNote"), notes: text(fd, "notes"),
    });
    refresh();
    return { status: "success", message: policyId ? "Saved." : "Policy added. You'll get a reminder before it ends." };
  } catch (error) { return fail(error); }
}

export async function archivePolicyAction(policyId: string, archive: boolean): Promise<void> {
  const session = await requireRole("OWNER");
  await archivePolicy(session.user.id, policyId, archive);
  refresh();
}

export async function remindersAction(_: InsuranceActionState, fd: FormData): Promise<InsuranceActionState> {
  const session = await requireRole("OWNER");
  try {
    const restore = fd.get("operation") === "restore";
    const first = restore ? REMIND_FIRST_DEFAULT : Number(text(fd, "first"));
    const second = restore ? REMIND_SECOND_DEFAULT : Number(text(fd, "second"));
    await saveReminderDays(session.user.id, first, second);
    refresh();
    return { status: "success", message: `Saved: reminders ${first} and ${second} days before a policy ends.` };
  } catch (error) { return fail(error); }
}

export async function workersCompAction(_: InsuranceActionState, fd: FormData): Promise<InsuranceActionState> {
  const session = await requireRole("OWNER");
  try {
    await saveWorkersComp(session.user.id, {
      status: text(fd, "status") as WorkersCompStatusValue, employees: Number(text(fd, "employees") || "0"), note: text(fd, "note"),
      formSentOnKey: text(fd, "formSentOn") || undefined, mailNumber: text(fd, "mailNumber"),
    });
    refresh();
    return { status: "success", message: "Saved." };
  } catch (error) { return fail(error); }
}

export async function certificateAction(policyId: string, _: InsuranceActionState, fd: FormData): Promise<InsuranceActionState> {
  const session = await requireRole("OWNER");
  try {
    const draft = await requestCertificate(session.user.id, policyId, {
      requesterName: text(fd, "requesterName"), requesterCompany: text(fd, "requesterCompany"), requesterEmail: text(fd, "requesterEmail"), holderText: text(fd, "holderText"),
    });
    refresh();
    return { status: "success", message: "Recorded. Open the email below, read it, and send it to your agent yourself.", mailto: draft.mailto };
  } catch (error) { return fail(error); }
}

export async function keepCertificateAction(policyId: string, _: InsuranceActionState): Promise<InsuranceActionState> {
  void _;
  const session = await requireRole("OWNER");
  try {
    const { created } = await keepCertificateOnRecord(session.user.id, policyId);
    refresh();
    revalidatePath("/desk/paperwork");
    return { status: "success", message: created ? "Done. Open the certificate record to upload the PDF." : "That policy already has a certificate record." };
  } catch (error) { return fail(error); }
}
