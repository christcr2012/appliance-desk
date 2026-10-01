import { beforeEach, expect, it, vi } from "vitest";
const provider = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email", () => ({ sendEmail: provider }));
import { requestInvitationEmail, sendPasswordEmail } from "@/lib/password-email";
beforeEach(() => { provider.mockReset().mockResolvedValue({ sent: true }); });
it("requires callback provider acceptance rather than generic auth success", async () => {
  expect(await requestInvitationEmail("a@example.com", async () => ({ status: true }))).toBe(false);
  const send = () => sendPasswordEmail({ to: "a@example.com", subject: "Setup", text: "link" });
  expect(await requestInvitationEmail(" A@Example.com ", send)).toBe(true);
  provider.mockResolvedValue({ sent: false });
  expect(await requestInvitationEmail("a@example.com", send)).toBe(false);
  provider.mockRejectedValue(new Error("offline"));
  expect(await requestInvitationEmail("a@example.com", send)).toBe(false);
});
it("does not expose provider failure through the public callback", async () => {
  provider.mockResolvedValue({ sent: false });
  await expect(sendPasswordEmail({ to: "known@example.com", subject: "Reset", text: "link" })).resolves.toBeUndefined();
});
it("isolates overlapping sends, even to the same email", async () => {
  let release!: () => void;
  const pause = new Promise<void>(resolve => { release = resolve; });
  provider.mockImplementation(async ({ text }) => {
    if (text === "accepted") { await pause; return { sent: true }; }
    release();
    return { sent: false };
  });
  const results = await Promise.all(["accepted", "rejected"].map(text => requestInvitationEmail("a@example.com", () => sendPasswordEmail({ to: "a@example.com", subject: "Setup", text }))));
  expect(results).toEqual([true, false]);
});
it("cannot attribute another recipient's callback to an invitation", async () => {
  expect(await requestInvitationEmail("a@example.com", () => sendPasswordEmail({ to: "b@example.com", subject: "Setup", text: "link" }))).toBe(false);
});
