"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { issueRtcPass, revokeRtcPass } from "@/domains/agent-control/passes";
import { rtcReadScopesForArea } from "@/mcp/rtc-read-scopes";

type PassFormState = { secret: string | null; expiresAt: string | null; error: string | null };
/** A pass is displayed only in the immediate owner response; never in URL, logs, or audit. */
export async function createRtcPassAction(
  _prior: PassFormState, form: FormData,
): Promise<PassFormState> {
  const session = await requireRole("OWNER");
  try {
    const area = String(form.get("area") ?? "");
    const created = await issueRtcPass(session.user.id, {
      label: String(form.get("label") ?? ""),
      scopes: rtcReadScopesForArea(area, form.get("decisionsRead") === "on"),
      expiresDays: Number(form.get("days") ?? 1),
      areas: area === "all" ? [] : [area],
    });
    revalidatePath("/desk/automations");
    return { secret: created.secret, expiresAt: created.expiresAt.toISOString(), error: null };
  } catch {
    return { secret: null, expiresAt: null,
      error: "Could not issue a pass. Check your owner account and two-step verification." };
  }
}

export async function revokeRtcPassAction(form: FormData): Promise<void> {
  const session = await requireRole("OWNER");
  await revokeRtcPass(session.user.id, String(form.get("id") ?? ""));
  revalidatePath("/desk/automations");
}
