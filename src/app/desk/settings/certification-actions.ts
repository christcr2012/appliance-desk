"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { removeTeamCertification, saveTeamCertification } from "@/domains/certifications/actions";

export type CertificationState = { status: "idle" } | { status: "success"; message: string } | { status: "error"; message: string };

export async function saveCertificationAction(userId: string, _: CertificationState, fd: FormData): Promise<CertificationState> {
  void _;
  const session = await requireRole("OWNER");
  try {
    await saveTeamCertification(session.user.id, userId, { certificationNumber: String(fd.get("number") ?? ""), issuedOnKey: String(fd.get("issuedOn") ?? "") || undefined });
    revalidatePath("/desk/settings");
    return { status: "success", message: "Saved." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't save that." };
  }
}

export async function removeCertificationAction(userId: string, _: CertificationState): Promise<CertificationState> {
  void _;
  const session = await requireRole("OWNER");
  try {
    await removeTeamCertification(session.user.id, userId);
    revalidatePath("/desk/settings");
    return { status: "success", message: "Removed." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't remove that." };
  }
}
