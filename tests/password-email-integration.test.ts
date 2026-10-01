import { beforeEach, describe, expect, it, vi } from "vitest";
const provider = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email", () => ({ sendEmail: provider }));
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requestInvitationEmail } from "@/lib/password-email";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname)
  && url.pathname === "/appliance_desk_test";
describe.skipIf(!enabled)("real Better Auth setup email acceptance", () => {
  beforeEach(() => { provider.mockReset().mockResolvedValue({ sent: true }); });
  it("observes the configured callback's provider result for the seeded account", async () => {
    const account = await prisma.user.findUniqueOrThrow({ where: { email: process.env.TEST_CUSTOMER_EMAIL ?? "ci-customer@example.test" } });
    const request = () => auth.api.requestPasswordReset({ body: { email: account.email, redirectTo: "/reset-password" } });
    expect(await requestInvitationEmail(account.email, request)).toBe(true);
    expect(provider).toHaveBeenCalledWith(expect.objectContaining({ to: account.email, subject: "Set your Appliance Desk password" }));
    provider.mockResolvedValue({ sent: false });
    expect(await requestInvitationEmail(account.email, request)).toBe(false);
  });
  it("preserves public generic success for failed sends and nonexistent accounts", async () => {
    const account = await prisma.user.findUniqueOrThrow({ where: { email: process.env.TEST_CUSTOMER_EMAIL ?? "ci-customer@example.test" } });
    provider.mockResolvedValue({ sent: false });
    const reset = (email: string) => auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });
    const known = await reset(account.email);
    const unknown = await reset("no-setup-account@example.invalid");
    expect(known).toEqual(unknown);
    expect(await requestInvitationEmail("no-setup-account@example.invalid", () => reset("no-setup-account@example.invalid"))).toBe(false);
  });
});
