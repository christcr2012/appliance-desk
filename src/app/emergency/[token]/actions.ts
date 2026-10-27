"use server";

import { revalidatePath } from "next/cache";
import {
  confirmEmergencyCode,
  requestEmergencyAccess,
  sendEmergencyCode,
} from "@/domains/vault/emergency";

export type EmergencyFlowState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; message: string };

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function requestAccessAction(
  token: string,
  _previous: EmergencyFlowState,
): Promise<EmergencyFlowState> {
  void _previous;
  try {
    await requestEmergencyAccess(token);
  } catch (error) {
    return { status: "error", message: messageOf(error, "The request could not be started.") };
  }
  revalidatePath(`/emergency/${token}`);
  return { status: "done", message: "Your request has started. The owner has been told." };
}

export async function sendCodeAction(
  token: string,
  _previous: EmergencyFlowState,
): Promise<EmergencyFlowState> {
  void _previous;
  try {
    const { channel } = await sendEmergencyCode(token);
    revalidatePath(`/emergency/${token}`);
    return {
      status: "done",
      message: channel === "text" ? "A code is on its way to your phone." : "A code is on its way to your email.",
    };
  } catch (error) {
    return { status: "error", message: messageOf(error, "The code could not be sent.") };
  }
}

export async function confirmCodeAction(
  token: string,
  _previous: EmergencyFlowState,
  formData: FormData,
): Promise<EmergencyFlowState> {
  const code = formData.get("code");
  if (typeof code !== "string" || code.trim() === "") {
    return { status: "error", message: "Type the code first." };
  }
  try {
    await confirmEmergencyCode(token, code.trim());
  } catch (error) {
    return { status: "error", message: messageOf(error, "That code was not accepted.") };
  }
  revalidatePath(`/emergency/${token}`);
  return { status: "done", message: "Code confirmed. Your download is ready below." };
}
