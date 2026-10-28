"use server";

// AR-2 slice 1: the approval decisions moved out of the approvals page so
// Today can call them too. The bodies are the page's original actions,
// unchanged except: with `inline=1` in the form they return { outcome }
// instead of redirecting (Today's Sheet shows the outcome as a toast), and
// finish now also revalidates /desk/today. Approving or declining still
// calls the same domain functions with the same arguments, OWNER only.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { ApprovalInputError, decideApproval, finishApprovedRequest } from "@/domains/approvals";

function outcomeOf(result: { status: string; state?: string | null }): string {
  return result.status === "APPROVED"
    ? ({ WAITING: "waiting", UNCERTAIN: "uncertain" } as Record<string, string>)[result.state ?? "DONE"] ?? "approved"
    : result.status.toLowerCase();
}

export async function decideApprovalAction(form: FormData) {
  const session = await requireRole("OWNER");
  let outcome = "refused";
  try {
    const result = await decideApproval(
      session.user.id,
      String(form.get("requestId") ?? ""),
      form.get("decision") === "APPROVE" ? "APPROVE" : "DECLINE",
      String(form.get("note") ?? ""),
    );
    outcome = outcomeOf(result);
  } catch (e) {
    if (!(e instanceof ApprovalInputError)) throw e;
  }
  revalidatePath("/desk/approvals");
  revalidatePath("/desk/today");
  if (form.get("inline") === "1") return { outcome };
  redirect(`/desk/approvals?outcome=${outcome}`);
}

export async function finishApprovalAction(form: FormData) {
  const session = await requireRole("OWNER");
  let outcome = "refused";
  try {
    const result = await finishApprovedRequest(session.user.id, String(form.get("requestId") ?? ""));
    outcome = outcomeOf(result);
  } catch (e) {
    if (!(e instanceof ApprovalInputError)) throw e;
  }
  revalidatePath("/desk/approvals");
  revalidatePath("/desk/today");
  if (form.get("inline") === "1") return { outcome };
  redirect(`/desk/approvals?outcome=${outcome}`);
}

// Void-returning form shapes for the approvals page itself: a <form action>
// may not return a value, and an inline async adapter defined in the page
// component is not a server action (Codex P1 on PR #727) — so the adapters
// live here, in the server-actions module.
export async function decideApprovalFormAction(form: FormData): Promise<void> {
  await decideApprovalAction(form);
}

export async function finishApprovalFormAction(form: FormData): Promise<void> {
  await finishApprovalAction(form);
}
