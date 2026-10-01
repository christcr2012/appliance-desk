import { AsyncLocalStorage } from "node:async_hooks";
import { sendEmail } from "./email";

// Better Auth deliberately returns generic reset success and catches callback
// errors. Capture provider acceptance only for trusted server-side invitations;
// public reset responses remain identical for known and unknown addresses.
const invitation = new AsyncLocalStorage<{ email: string; accepted: boolean }>();

export async function sendPasswordEmail(input: Parameters<typeof sendEmail>[0]) {
  const result = await sendEmail(input);
  const current = invitation.getStore();
  if (current?.email === input.to.trim().toLowerCase()) current.accepted = result.sent;
}

/** Fail closed if the callback did not run, was suppressed, or failed. Request
 * context prevents overlapping invitations from sharing another send's result. */
export async function requestInvitationEmail(email: string, request: () => Promise<unknown>): Promise<boolean> {
  const result = { email: email.trim().toLowerCase(), accepted: false };
  return invitation.run(result, async () => {
    try {
      await request();
      return result.accepted;
    } catch {
      return false;
    }
  });
}
