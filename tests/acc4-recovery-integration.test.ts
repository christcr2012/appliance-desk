import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sent } = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string }[] }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async (m: { to: string; subject: string; text: string }) => { sent.push(m); return { sent: true, outcome: "SENT" }; }) }));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { createTrustedCredentialUserInTx } from "@/lib/account-provisioning";
import { acceptInvitation, getJoinView, resetTeamSignIn } from "@/domains/team";
import { hashInvitationCode } from "@/domains/team/rules";
import { noteCompletedSignIn, pausedMessageFor, recordFailedSignIn, recordPasswordAccepted, updatePauseSettings } from "@/domains/security/sign-in-guard";

// ACC-4 on real Postgres: the wrong-password pause triggers and clears, an owner's reset of a sign-in is complete and
// single-use, and no notice email contains a sign-in link.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";
const PASSWORD = "Acc4-Test-Password-2026!";

describe.skipIf(!enabled)("Sign-in recovery on real Postgres", () => {
  const tag = randomUUID().slice(0, 8);
  const ids = { owner: `acc4-owner-${tag}`, admin: `acc4-admin-${tag}`, staff: `acc4-staff-${tag}`, login: `acc4-login-${tag}` };
  const email = (who: string) => `${tag}-${who}@example.test`;
  let before: { signInPauseAttempts: number; signInPauseMinutes: number; invitationLinkDays: number } | null = null;

  beforeAll(async () => {
    before = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { signInPauseAttempts: true, signInPauseMinutes: true, invitationLinkDays: true } });
    await prisma.user.create({ data: { id: ids.owner, name: "Owner", email: email("owner"), role: "OWNER", emailVerified: true } });
    await prisma.user.create({ data: { id: ids.admin, name: "Admin", email: email("admin"), role: "ADMIN", emailVerified: true } });
    await prisma.user.create({ data: { id: ids.staff, name: "Staff", email: email("staff"), role: "STAFF", emailVerified: true, twoFactorEnabled: true, secondStepMethod: "TOTP" } });
    await prisma.twoFactor.create({ data: { id: `tf-${tag}`, userId: ids.staff, secret: "x", backupCodes: "y" } });
    await prisma.session.create({ data: { token: `tok-${tag}`, userId: ids.staff, expiresAt: new Date(Date.now() + 86400_000) } });
    const login = await prisma.$transaction((tx) => createTrustedCredentialUserInTx(tx, { email: email("login"), name: "Login", role: "STAFF", password: PASSWORD }));
    ids.login = login.id;
    await updatePauseSettings(ids.owner, { attempts: 3, minutes: 15 });
  });
  beforeEach(() => { sent.length = 0; });
  afterAll(async () => {
    const mine = await prisma.user.findMany({ where: { email: { startsWith: tag } }, select: { id: true } });
    const userIds = mine.map((u) => u.id);
    await prisma.teamInvitation.deleteMany({ where: { email: { startsWith: tag } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { entityId: { in: userIds } }] } });
    await prisma.twoFactor.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (before) await prisma.businessSettings.update({ where: { id: "singleton" }, data: before });
  });

  it("only the owner sets the pause numbers, within a sensible range", async () => {
    await expect(updatePauseSettings(ids.admin, { attempts: 5, minutes: 5 })).rejects.toThrow();
    await expect(updatePauseSettings(ids.owner, { attempts: 1, minutes: 5 })).rejects.toThrow();
    expect(await updatePauseSettings(ids.owner, { attempts: 3, minutes: 15 })).toEqual({ attempts: 3, minutes: 15 });
  });

  it("pauses an account after the allowed wrong passwords, tells the person once, and a right password clears it", async () => {
    expect(await pausedMessageFor(email("staff"))).toBeNull();
    expect((await recordFailedSignIn(email("staff"))).justPaused).toBe(false);
    expect((await recordFailedSignIn(email("staff"))).justPaused).toBe(false);
    expect((await recordFailedSignIn(email("staff"))).justPaused).toBe(true);
    expect(await pausedMessageFor(email("staff").toUpperCase())).toContain("paused");
    // tries during the wait neither extend the wait nor send a second notice
    expect((await recordFailedSignIn(email("staff"))).justPaused).toBe(false);
    expect(sent.filter((m) => m.to === email("staff"))).toHaveLength(1);
    expect(sent[0]!.text).not.toMatch(/https?:\/\//);
    expect(await prisma.auditLog.count({ where: { userId: ids.staff, action: "security.sign_in_paused" } })).toBe(1);
    await recordPasswordAccepted(ids.staff);
    expect(await pausedMessageFor(email("staff"))).toBeNull();
    expect((await recordFailedSignIn("nobody@example.test")).userId).toBeNull(); // unknown address: nothing to pause
  });

  it("the sign-in itself refuses a paused account and counts wrong passwords through the real sign-in call", async () => {
    await prisma.user.update({ where: { id: ids.login }, data: { failedSignInCount: 0, failedSignInWindowStartedAt: null, signInPausedUntil: null } });
    for (let i = 0; i < 3; i++) await expect(auth.api.signInEmail({ body: { email: email("login"), password: "wrong-password-1" } })).rejects.toThrow();
    expect(await pausedMessageFor(email("login"))).toContain("paused");
    // even the right password waits
    await expect(auth.api.signInEmail({ body: { email: email("login"), password: PASSWORD } })).rejects.toThrow(/paused|Too many/i);
    await prisma.user.update({ where: { id: ids.login }, data: { signInPausedUntil: new Date(Date.now() - 1000) } });
    const ok = await auth.api.signInEmail({ body: { email: email("login"), password: PASSWORD } });
    expect(ok.user.email).toBe(email("login"));
    const row = await prisma.user.findUniqueOrThrow({ where: { id: ids.login } });
    expect(row.failedSignInCount).toBe(0);
    expect(row.signInPausedUntil).toBeNull();
  });

  it("tells a team member about a sign-in from a device not seen before, but not the first one", async () => {
    const chrome = "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36";
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari/604.1";
    expect(await noteCompletedSignIn(ids.admin, chrome)).toBe("first");
    expect(await noteCompletedSignIn(ids.admin, chrome)).toBe("known");
    expect(sent).toHaveLength(0);
    expect(await noteCompletedSignIn(ids.admin, iphone)).toBe("new");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).not.toMatch(/https?:\/\//);
    expect(await noteCompletedSignIn(ids.admin, iphone)).toBe("known");
  });

  it("an owner's reset turns off two-step, signs the person out, and the link sets a new password exactly once", async () => {
    await expect(resetTeamSignIn(ids.admin, ids.staff)).rejects.toThrow();
    await expect(resetTeamSignIn(ids.owner, ids.owner)).rejects.toThrow("own sign-in");
    await expect(resetTeamSignIn(ids.owner, "no-such-user")).rejects.toThrow();
    const r = await resetTeamSignIn(ids.owner, ids.staff);
    expect(r.emailOutcome).toBe("SENT");
    const staff = await prisma.user.findUniqueOrThrow({ where: { id: ids.staff } });
    expect(staff.twoFactorEnabled).toBe(false);
    expect(staff.secondStepMethod).toBeNull();
    expect(await prisma.twoFactor.count({ where: { userId: ids.staff } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: ids.staff } })).toBe(0);
    expect(sent.map((m) => m.subject).sort()).toEqual(["Choose a new password for Appliance Desk", "Your sign-in was reset by the owner"]);
    expect(sent.find((m) => m.subject.startsWith("Your sign-in"))!.text).not.toMatch(/https?:\/\//);

    const inv = await prisma.teamInvitation.findFirstOrThrow({ where: { targetUserId: ids.staff, purpose: "RESET", status: "INVITED" } });
    const code = `known-${randomUUID()}-${randomUUID()}`;
    await prisma.teamInvitation.update({ where: { id: inv.id }, data: { codeHash: hashInvitationCode(code) } });
    expect(await getJoinView(code)).toMatchObject({ ok: true, reset: true, email: email("staff") });
    await acceptInvitation(code, PASSWORD, PASSWORD);
    const login = await auth.api.signInEmail({ body: { email: email("staff"), password: PASSWORD } });
    expect(login.user.id).toBe(ids.staff);
    await expect(acceptInvitation(code, PASSWORD, PASSWORD)).rejects.toThrow("no longer works");
    // a second reset replaces any earlier open link
    await resetTeamSignIn(ids.owner, ids.staff);
    await resetTeamSignIn(ids.owner, ids.staff);
    expect(await prisma.teamInvitation.count({ where: { targetUserId: ids.staff, purpose: "RESET", status: "INVITED" } })).toBe(1);
  });

  it("a reset cannot be aimed at an owner or at someone who was removed", async () => {
    await prisma.user.update({ where: { id: ids.admin }, data: { archivedAt: new Date() } });
    await expect(resetTeamSignIn(ids.owner, ids.admin)).rejects.toThrow("Restore");
    await prisma.user.update({ where: { id: ids.admin }, data: { archivedAt: null } });
    const secondOwner = await prisma.user.create({ data: { id: `acc4-o2-${tag}`, name: "O2", email: email("o2"), role: "OWNER", emailVerified: true } });
    await expect(resetTeamSignIn(ids.owner, secondOwner.id)).rejects.toThrow("staff and admin");
  });
});
