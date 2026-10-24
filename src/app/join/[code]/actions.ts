"use server";

import { TeamError, acceptInvitation } from "@/domains/team";

export type JoinResult = { status: "success"; email: string } | { status: "error"; message: string };

/** Public on purpose: the long secret code in the link is the proof. Rules and one-time use live in the domain. */
export async function acceptInvitationAction(code: string, password: string, confirm: string): Promise<JoinResult> {
  try {
    const { email } = await acceptInvitation(code, password, confirm);
    return { status: "success", email };
  } catch (error) {
    return { status: "error", message: error instanceof TeamError ? error.message : "We couldn't finish setting up your account. Try the link again, or ask the owner for a new one." };
  }
}
