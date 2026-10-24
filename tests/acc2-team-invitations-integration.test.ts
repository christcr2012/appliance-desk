import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { CapabilityError, assertCapability } from "@/domains/capabilities";
import {
  TeamError, acceptInvitation, cancelInvitation, changeAccessLevel, getJoinView, getTeam, inviteTeamMember,
  removeTeamMember, resendInvitation, restoreTeamMember, updateTeamSettings,
} from "@/domains/team";
import { hashInvitationCode } from "@/domains/team/rules";

// ACC-2 on real Postgres: invitations are not logins, links work once, and only the owner can create admins.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";
const PASSWORD = "Acc2-Test-Password-2026!";

describe.skipIf(!enabled)("Team invitations on real Postgres", () => {
  const tag = randomUUID().slice(0, 8);
  const ids = { owner: `acc2-owner-${tag}`, admin: `acc2-admin-${tag}`, admin2: `acc2-admin2-${tag}`, staff: `acc2-staff-${tag}`, customer: `acc2-cust-${tag}` };
  const email = (who: string) => `${tag}-${who}@example.test`;
  let before: { invitationLinkDays: number; adminsMayInviteStaff: boolean } | null = null;

  /** The real code is only ever emailed; tests swap in a known one so they can open the link. */
  async function knownCode(invitationId: string) {
    const code = `known-${randomUUID()}-${randomUUID()}`;
    await prisma.teamInvitation.update({ where: { id: invitationId }, data: { codeHash: hashInvitationCode(code) } });
    return code;
  }
  async function invite(actor: string, who: string, level = "STAFF", limits: string[] = []) {
    const r = await inviteTeamMember(actor, { name: `Invitee ${who}`, email: email(who), accessLevel: level, adminCapabilityLimits: limits });
    return r.invitationId;
  }

  beforeAll(async () => {
    before = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { invitationLinkDays: true, adminsMayInviteStaff: true } });
    await prisma.user.create({ data: { id: ids.owner, name: "Owner", email: email("owner"), role: "OWNER", emailVerified: true } });
    await prisma.user.create({ data: { id: ids.admin, name: "Admin", email: email("admin"), role: "ADMIN", emailVerified: true } });
    await prisma.user.create({ data: { id: ids.admin2, name: "Admin Two", email: email("admin2"), role: "ADMIN", emailVerified: true } });
    await prisma.user.create({ data: { id: ids.staff, name: "Staff", email: email("staff"), role: "STAFF", emailVerified: true } });
    await prisma.user.create({ data: { id: ids.customer, name: "Customer", email: email("cust"), role: "CUSTOMER", emailVerified: true } });
    await updateTeamSettings(ids.owner, { invitationLinkDays: 7, adminsMayInviteStaff: false });
  });
  afterAll(async () => {
    const mine = await prisma.user.findMany({ where: { email: { startsWith: tag } }, select: { id: true } });
    const userIds = mine.map((u) => u.id);
    await prisma.staffCapabilityOverride.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.teamInvitation.deleteMany({ where: { email: { startsWith: tag } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { entityId: { in: userIds } }] } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (before) await prisma.businessSettings.update({ where: { id: "singleton" }, data: before });
  });

  it("an invitation is not a login: no user exists until the link is used", async () => {
    const id = await invite(ids.owner, "a1");
    expect(await prisma.user.findUnique({ where: { email: email("a1") } })).toBeNull();
    const row = await prisma.teamInvitation.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("INVITED");
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 86400_000);
  });

  it("admins cannot invite admins, and cannot invite staff until the owner allows it", async () => {
    await expect(inviteTeamMember(ids.admin, { name: "X", email: email("x1"), accessLevel: "ADMIN" })).rejects.toThrow("Only the owner");
    await expect(inviteTeamMember(ids.admin, { name: "X", email: email("x2"), accessLevel: "STAFF" })).rejects.toThrow("not allowed");
    await updateTeamSettings(ids.owner, { invitationLinkDays: 7, adminsMayInviteStaff: true });
    await expect(inviteTeamMember(ids.admin, { name: "X", email: email("x3"), accessLevel: "ADMIN" })).rejects.toThrow("Only the owner");
    await expect(inviteTeamMember(ids.admin, { name: "Ok", email: email("x4"), accessLevel: "STAFF" })).resolves.toBeTruthy();
    await expect(inviteTeamMember(ids.staff, { name: "X", email: email("x5"), accessLevel: "STAFF" })).rejects.toThrow();
    await updateTeamSettings(ids.owner, { invitationLinkDays: 7, adminsMayInviteStaff: false });
  });

  it("refuses an email that already belongs to a customer, a team member, or an open invitation", async () => {
    await expect(inviteTeamMember(ids.owner, { name: "C", email: email("cust").toUpperCase(), accessLevel: "STAFF" })).rejects.toThrow("customer account");
    await expect(inviteTeamMember(ids.owner, { name: "S", email: email("staff"), accessLevel: "STAFF" })).rejects.toThrow("someone on the team");
    await expect(inviteTeamMember(ids.owner, { name: "D", email: email("a1"), accessLevel: "STAFF" })).rejects.toThrow("open invitation");
  });

  it("accepting creates the login once, with the invited level, and the link then stops working", async () => {
    const id = await invite(ids.owner, "b1");
    const code = await knownCode(id);
    expect(await getJoinView(code)).toMatchObject({ ok: true, email: email("b1"), accessLevel: "Staff" });
    await expect(acceptInvitation(code, "short", "short")).rejects.toThrow("at least 10");
    await acceptInvitation(code, PASSWORD, PASSWORD);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: email("b1") }, include: { accounts: true } });
    expect(user.role).toBe("STAFF");
    expect(user.accounts[0]?.providerId).toBe("credential");
    expect((await prisma.teamInvitation.findUniqueOrThrow({ where: { id } })).status).toBe("ACCEPTED");
    expect(await getJoinView(code)).toMatchObject({ ok: false });
    await expect(acceptInvitation(code, PASSWORD, PASSWORD)).rejects.toThrow("no longer works");
  });

  it("two people racing on one link create exactly one account", async () => {
    const id = await invite(ids.owner, "r1");
    const code = await knownCode(id);
    const results = await Promise.allSettled([acceptInvitation(code, PASSWORD, PASSWORD), acceptInvitation(code, PASSWORD, PASSWORD)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.user.count({ where: { email: email("r1") } })).toBe(1);
  });

  it("expired, cancelled and replaced links are refused", async () => {
    const expired = await invite(ids.owner, "e1");
    const expiredCode = await knownCode(expired);
    await prisma.teamInvitation.update({ where: { id: expired }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(acceptInvitation(expiredCode, PASSWORD, PASSWORD)).rejects.toThrow("no longer works");
    expect((await getTeam()).invitations.find((i) => i.id === expired)?.state).toBe("EXPIRED");

    const cancelled = await invite(ids.owner, "c1");
    const cancelledCode = await knownCode(cancelled);
    await cancelInvitation(ids.owner, cancelled);
    await expect(acceptInvitation(cancelledCode, PASSWORD, PASSWORD)).rejects.toThrow("no longer works");

    const resent = await invite(ids.owner, "s1");
    const oldCode = await knownCode(resent);
    await resendInvitation(ids.owner, resent);
    await expect(acceptInvitation(oldCode, PASSWORD, PASSWORD)).rejects.toThrow("no longer works");
    // an expired invitation can be sent again and then works
    await resendInvitation(ids.owner, expired);
    expect((await prisma.teamInvitation.findUniqueOrThrow({ where: { id: expired } })).expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("an invited admin's switched-off permissions are in force on the first action", async () => {
    const id = await invite(ids.owner, "ad1", "ADMIN", ["WRITE_OFF", "ISSUE_REFUND"]);
    await acceptInvitation(await knownCode(id), PASSWORD, PASSWORD);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: email("ad1") } });
    expect(admin.role).toBe("ADMIN");
    await prisma.$transaction(async (tx) => {
      await expect(assertCapability(tx, admin.id, "WRITE_OFF")).rejects.toThrow(CapabilityError);
      await expect(assertCapability(tx, admin.id, "ISSUE_REFUND")).rejects.toThrow(CapabilityError);
      await expect(assertCapability(tx, admin.id, "POST_EXPENSES")).resolves.toBeTruthy();
    });
  });

  it("only the owner changes access levels; it signs the person out and promotion starts with everything off", async () => {
    await prisma.session.create({ data: { token: `tok-${tag}`, userId: ids.staff, expiresAt: new Date(Date.now() + 86400_000) } });
    await expect(changeAccessLevel(ids.admin, ids.staff, "ADMIN", [])).rejects.toThrow();
    await expect(changeAccessLevel(ids.owner, ids.owner, "STAFF", [])).rejects.toThrow("own access");
    await changeAccessLevel(ids.owner, ids.staff, "ADMIN", ["POST_EXPENSES"]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.staff } })).role).toBe("ADMIN");
    expect(await prisma.session.count({ where: { userId: ids.staff } })).toBe(0);
    await prisma.$transaction(async (tx) => {
      await expect(assertCapability(tx, ids.staff, "ISSUE_REFUND")).rejects.toThrow(CapabilityError);
      await expect(assertCapability(tx, ids.staff, "POST_EXPENSES")).resolves.toBeTruthy();
    });
    expect(await prisma.auditLog.count({ where: { action: "team.role_change", entityId: ids.staff } })).toBe(1);
    await changeAccessLevel(ids.owner, ids.staff, "STAFF", []);
    expect(await prisma.staffCapabilityOverride.count({ where: { userId: ids.staff } })).toBe(0);
  });

  it("an owner can never be demoted or removed here, and admins cannot touch admins", async () => {
    await expect(changeAccessLevel(ids.owner, ids.owner, "ADMIN", [])).rejects.toThrow(TeamError);
    await expect(removeTeamMember(ids.admin, ids.owner)).rejects.toThrow("owner account");
    await expect(removeTeamMember(ids.owner, ids.owner)).rejects.toThrow("your own");
    await expect(removeTeamMember(ids.admin, ids.admin2)).rejects.toThrow("Only the owner");
    await removeTeamMember(ids.owner, ids.admin2);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.admin2 } })).archivedAt).not.toBeNull();
    await expect(restoreTeamMember(ids.admin, ids.admin2)).rejects.toThrow("Only the owner");
    await restoreTeamMember(ids.owner, ids.admin2);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.admin2 } })).archivedAt).toBeNull();
    await removeTeamMember(ids.admin, ids.staff);
    await restoreTeamMember(ids.admin, ids.staff);
  });

  it("a removed inviter's link stops working; the owner sending it again makes a working link", async () => {
    await updateTeamSettings(ids.owner, { invitationLinkDays: 7, adminsMayInviteStaff: true });
    try {
      const id = await invite(ids.admin2, "r9");
      await removeTeamMember(ids.owner, ids.admin2);
      const stale = await knownCode(id);
      await expect(acceptInvitation(stale, PASSWORD, PASSWORD)).rejects.toThrow(TeamError);
      await resendInvitation(ids.owner, id);
      expect((await prisma.teamInvitation.findUniqueOrThrow({ where: { id } })).invitedById).toBe(ids.owner);
      const fresh = await knownCode(id);
      await acceptInvitation(fresh, PASSWORD, PASSWORD);
      expect(await prisma.user.findUnique({ where: { email: email("r9") } })).not.toBeNull();
    } finally {
      await restoreTeamMember(ids.owner, ids.admin2).catch(() => undefined);
      await updateTeamSettings(ids.owner, { invitationLinkDays: 7, adminsMayInviteStaff: false });
    }
  });

  it("the owner can sign an admin out everywhere, but not an owner or a customer", async () => {
    const { revokeStaffSessionsByOwner } = await import("@/domains/security/sessions");
    await prisma.session.create({ data: { id: `s-${tag}`, token: `tok-${tag}`, userId: ids.admin, expiresAt: new Date(Date.now() + 3_600_000) } });
    expect(await revokeStaffSessionsByOwner(ids.owner, ids.admin)).toBe(1);
    await expect(revokeStaffSessionsByOwner(ids.owner, ids.owner)).rejects.toThrow();
    await expect(revokeStaffSessionsByOwner(ids.owner, ids.customer)).rejects.toThrow();
  });

  it("the Team list never exposes codes or hashes", async () => {
    const team = await getTeam();
    const text = JSON.stringify(team);
    expect(text).not.toContain("codeHash");
    expect(text).not.toContain("known-");
    expect(team.invitations.length).toBeGreaterThan(0);
  });
});
