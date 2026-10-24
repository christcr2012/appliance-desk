import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { CapabilityError, assertCapability } from "@/domains/capabilities";
import { TeamError, acceptInvitation, changeAccessLevel, inviteTeamMember, updateTeamSettings } from "@/domains/team";
import { hashInvitationCode } from "@/domains/team/rules";
import {
  JobRoleError, archiveJobRole, assignJobRole, listJobRoles, restoreStarterJobRole, saveJobRole, screensForUser,
} from "@/domains/team/job-roles";

// ACC-5 on real Postgres: job roles only narrow, only the owner edits them, and people lose nothing they had by being given one.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";
const PASSWORD = "Acc5-Test-Password-2026!";

describe.skipIf(!enabled)("Job roles on real Postgres", () => {
  const tag = randomUUID().slice(0, 8);
  const ids = { owner: `acc5-owner-${tag}`, admin: `acc5-admin-${tag}`, staff: `acc5-staff-${tag}`, staff2: `acc5-staff2-${tag}` };
  const email = (who: string) => `${tag}-${who}@example.test`;
  const createdRoles: string[] = [];
  let settingsBefore: { invitationLinkDays: number; adminsMayInviteStaff: boolean } | null = null;

  beforeAll(async () => {
    settingsBefore = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { invitationLinkDays: true, adminsMayInviteStaff: true } });
    await prisma.user.create({ data: { id: ids.owner, name: "Owner", email: email("owner"), role: "OWNER", emailVerified: true } });
    await prisma.user.create({ data: { id: ids.admin, name: "Admin", email: email("admin"), role: "ADMIN", emailVerified: true } });
    await prisma.user.create({ data: { id: ids.staff, name: "Staff", email: email("staff"), role: "STAFF", emailVerified: true } });
    await prisma.user.create({ data: { id: ids.staff2, name: "Staff Two", email: email("staff2"), role: "STAFF", emailVerified: true } });
  });
  afterAll(async () => {
    const mine = await prisma.user.findMany({ where: { email: { startsWith: tag } }, select: { id: true } });
    const userIds = mine.map((u) => u.id);
    await prisma.staffCapabilityOverride.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.teamInvitation.deleteMany({ where: { email: { startsWith: tag } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { entityId: { in: [...userIds, ...createdRoles] } }] } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.jobRole.deleteMany({ where: { id: { in: createdRoles } } });
    if (settingsBefore) await prisma.businessSettings.update({ where: { id: "singleton" }, data: settingsBefore });
  });

  it("starts with the four starting job roles", async () => {
    const roles = await listJobRoles();
    const starters = roles.filter((r) => r.isStarter).map((r) => r.label).sort();
    expect(starters).toEqual(["Bookkeeper", "Driver / technician", "Manager", "Office"]);
    const bookkeeper = roles.find((r) => r.id === "jobrole-bookkeeper")!;
    expect(bookkeeper.accessLevel).toBe("ADMIN");
    expect(bookkeeper.capabilityLimits).toEqual(["EDIT_SETTINGS"]);
  });

  it("only the owner edits job roles, and staff can never be given a money screen", async () => {
    await expect(saveJobRole(ids.admin, { label: `Nope ${tag}`, accessLevel: "STAFF", screens: ["tasks"] })).rejects.toThrow(JobRoleError);
    await expect(saveJobRole(ids.staff, { label: `Nope ${tag}`, accessLevel: "STAFF", screens: ["tasks"] })).rejects.toThrow(JobRoleError);
    await expect(saveJobRole(ids.owner, { label: `Cashier ${tag}`, accessLevel: "STAFF", screens: ["billing"] })).rejects.toThrow(/Staff cannot/);
    const made = await saveJobRole(ids.owner, { label: `Front desk ${tag}`, accessLevel: "STAFF", screens: ["customers", "leads"] });
    createdRoles.push(made.id);
    await expect(saveJobRole(ids.owner, { label: `FRONT DESK ${tag}`, accessLevel: "STAFF", screens: ["tasks"] })).rejects.toThrow(/already a job role/);
    expect(await prisma.auditLog.count({ where: { action: "team.job_role.create", entityId: made.id } })).toBe(1);
  });

  it("giving someone a job role limits their screens, signs them out, is audited, and removing it gives back the level's default", async () => {
    const roleId = createdRoles[0];
    expect(await screensForUser(ids.staff)).toBeNull();
    await prisma.session.create({ data: { id: `s5-${tag}`, token: `tok5-${tag}`, userId: ids.staff, expiresAt: new Date(Date.now() + 3_600_000) } });
    await assignJobRole(ids.owner, ids.staff, roleId);
    expect(await screensForUser(ids.staff)).toEqual(["customers", "leads"]);
    expect(await prisma.session.count({ where: { userId: ids.staff } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "team.job_role.assign", entityId: ids.staff } })).toBe(1);
    await assignJobRole(ids.owner, ids.staff, null);
    expect(await screensForUser(ids.staff)).toBeNull();
  });

  it("a job role must fit the person's level, and only the owner can hand them out", async () => {
    await expect(assignJobRole(ids.owner, ids.staff, "jobrole-bookkeeper")).rejects.toThrow(/for Admins/);
    await expect(assignJobRole(ids.owner, ids.admin, "jobrole-office")).rejects.toThrow(/for Staff/);
    await expect(assignJobRole(ids.admin, ids.staff, "jobrole-office")).rejects.toThrow(JobRoleError);
    await expect(assignJobRole(ids.owner, ids.owner, "jobrole-manager")).rejects.toThrow(/Owners always/);
  });

  it("an admin job role switches its permissions off and never any on", async () => {
    await assignJobRole(ids.owner, ids.admin, "jobrole-bookkeeper");
    await prisma.$transaction(async (tx) => {
      await expect(assertCapability(tx, ids.admin, "EDIT_SETTINGS")).rejects.toThrow(CapabilityError);
      await expect(assertCapability(tx, ids.admin, "POST_EXPENSES")).resolves.toBeTruthy();
    });
    expect(await screensForUser(ids.admin)).toContain("billing");
    expect(await screensForUser(ids.admin)).not.toContain("management");
  });

  it("changing the access level drops the job role; a mismatched role grants nothing", async () => {
    await changeAccessLevel(ids.owner, ids.admin, "STAFF", []);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.admin } })).jobRoleId).toBeNull();
    await changeAccessLevel(ids.owner, ids.admin, "ADMIN", ["POST_EXPENSES"]);
    // Force a mismatch the way a bad edit or restore could: a staff person pointing at an admin job role.
    await prisma.user.update({ where: { id: ids.staff2 }, data: { jobRoleId: "jobrole-bookkeeper" } });
    expect(await screensForUser(ids.staff2)).toEqual([]);
    await prisma.user.update({ where: { id: ids.staff2 }, data: { jobRoleId: "jobrole-gone" } });
    expect(await screensForUser(ids.staff2)).toEqual([]);
    await prisma.user.update({ where: { id: ids.staff2 }, data: { jobRoleId: null } });
  });

  it("a job role in use cannot be archived or change level; archived roles cannot be handed out", async () => {
    const roleId = createdRoles[0];
    await assignJobRole(ids.owner, ids.staff2, roleId);
    await expect(archiveJobRole(ids.owner, roleId)).rejects.toThrow(/1 person has/);
    await expect(saveJobRole(ids.owner, { id: roleId, label: `Front desk ${tag}`, accessLevel: "ADMIN", screens: ["customers"] })).rejects.toThrow(/Move the people/);
    await saveJobRole(ids.owner, { id: roleId, label: `Front desk ${tag}`, accessLevel: "STAFF", screens: ["customers", "leads", "tasks"] });
    expect(await screensForUser(ids.staff2)).toEqual(["customers", "leads", "tasks"]);
    await assignJobRole(ids.owner, ids.staff2, null);
    await archiveJobRole(ids.owner, roleId);
    await expect(assignJobRole(ids.owner, ids.staff, roleId)).rejects.toThrow(/not available/);
  });

  it("restore recommended puts a starting job role back to its starting screens", async () => {
    await prisma.jobRole.update({ where: { id: "jobrole-office" }, data: { screens: ["tasks"], label: "Office changed" } });
    await restoreStarterJobRole(ids.owner, "jobrole-office");
    const row = await prisma.jobRole.findUniqueOrThrow({ where: { id: "jobrole-office" } });
    expect(row.label).toBe("Office");
    expect(row.screens).toContain("customers");
    await expect(restoreStarterJobRole(ids.owner, createdRoles[0])).rejects.toThrow(JobRoleError);
  });

  it("an invitation can carry a job role; using the link applies it, and a wrong-level role is refused up front", async () => {
    await expect(inviteTeamMember(ids.owner, { name: "Wrong", email: email("w1"), accessLevel: "STAFF", jobRoleId: "jobrole-bookkeeper" })).rejects.toThrow(TeamError);
    const r = await inviteTeamMember(ids.owner, { name: "Bookkeeper Bea", email: email("bea"), accessLevel: "ADMIN", jobRoleId: "jobrole-bookkeeper", adminCapabilityLimits: ["WRITE_OFF"] });
    const code = `known-${randomUUID()}-${randomUUID()}`;
    await prisma.teamInvitation.update({ where: { id: r.invitationId }, data: { codeHash: hashInvitationCode(code) } });
    await acceptInvitation(code, PASSWORD, PASSWORD);
    const bea = await prisma.user.findUniqueOrThrow({ where: { email: email("bea") } });
    expect(bea.jobRoleId).toBe("jobrole-bookkeeper");
    await prisma.$transaction(async (tx) => {
      await expect(assertCapability(tx, bea.id, "EDIT_SETTINGS")).rejects.toThrow(CapabilityError);
      await expect(assertCapability(tx, bea.id, "WRITE_OFF")).rejects.toThrow(CapabilityError);
      await expect(assertCapability(tx, bea.id, "ISSUE_REFUND")).resolves.toBeTruthy();
    });
    // An admin may invite staff (when the owner allows it) with a staff job role, never with an admin one.
    await updateTeamSettings(ids.owner, { invitationLinkDays: 7, adminsMayInviteStaff: true });
    await inviteTeamMember(ids.admin, { name: "Office Ollie", email: email("ollie"), accessLevel: "STAFF", jobRoleId: "jobrole-office" });
    await expect(inviteTeamMember(ids.admin, { name: "Nope", email: email("w2"), accessLevel: "STAFF", jobRoleId: "jobrole-manager" })).rejects.toThrow(TeamError);
  });

  it("switching another admin permission off in a job role applies to the people who already have it", async () => {
    const created = await saveJobRole(ids.owner, { label: `Counter admin ${tag}`, accessLevel: "ADMIN", screens: ["customers"], capabilityLimits: [] });
    createdRoles.push(created.id);
    await prisma.staffCapabilityOverride.deleteMany({ where: { userId: ids.admin } });
    await assignJobRole(ids.owner, ids.admin, created.id);
    await prisma.$transaction(async (tx) => { await expect(assertCapability(tx, ids.admin, "ISSUE_REFUND")).resolves.toBeTruthy(); });
    await saveJobRole(ids.owner, { id: created.id, label: `Counter admin ${tag}`, accessLevel: "ADMIN", screens: ["customers"], capabilityLimits: ["ISSUE_REFUND"] });
    await prisma.$transaction(async (tx) => { await expect(assertCapability(tx, ids.admin, "ISSUE_REFUND")).rejects.toThrow(CapabilityError); });
    await assignJobRole(ids.owner, ids.admin, null);
    await prisma.staffCapabilityOverride.deleteMany({ where: { userId: ids.admin } });
  });

  it("a job role with an invitation waiting cannot be archived, and a link whose job role went away is refused", async () => {
    const created = await saveJobRole(ids.owner, { label: `Waiting role ${tag}`, accessLevel: "STAFF", screens: ["customers"] });
    createdRoles.push(created.id);
    const r = await inviteTeamMember(ids.owner, { name: "Waiting Wes", email: email("wes"), accessLevel: "STAFF", jobRoleId: created.id });
    await expect(archiveJobRole(ids.owner, created.id)).rejects.toThrow(/invitation is waiting/);
    // Even if the role is archived some other way, the link must not quietly give more than the owner meant.
    await prisma.jobRole.update({ where: { id: created.id }, data: { archivedAt: new Date() } });
    const code = `known-${randomUUID()}-${randomUUID()}`;
    await prisma.teamInvitation.update({ where: { id: r.invitationId }, data: { codeHash: hashInvitationCode(code) } });
    await expect(acceptInvitation(code, PASSWORD, PASSWORD)).rejects.toThrow(/job role .* no longer available/);
    expect(await prisma.user.count({ where: { email: email("wes") } })).toBe(0);
  });
});
