import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  assignableLeadOwners,
  chooseOwnerForNewLeadInTx,
  reassignLead,
  saveLeadAssignment,
} from "@/domains/leads/assignment";
import { createLeadManually } from "@/domains/leads";

// Disposable CI Postgres only; never creates fixtures or attempts rollback on Neon.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("lead assignment", () => {
  const tag = randomUUID();
  let ownerId: string;
  let admin1Id: string;
  let admin2Id: string;
  let staffId: string;
  let staffLeadsId: string;
  let staffNoLeadsId: string;
  let blockedAdminId: string;
  let jobRoleId: string;
  let staffLeadsRoleId: string;
  let staffNoLeadsRoleId: string;
  const leadIds: string[] = [];
  const userIds: string[] = [];
  let savedMode: string | null = null;
  let savedPersonId: string | null = null;
  let savedCursor: string | null = null;

  async function setMode(
    mode: "OWNER" | "PERSON" | "ROTATE",
    personId: string | null = null,
    cursor: string | null = null,
  ) {
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { leadAssignmentMode: mode, leadAssignmentUserId: personId, leadRotationCursor: cursor },
    });
  }

  async function makeLead() {
    const lead = await createLeadManually(ownerId, {
      contactName: `Assignment fixture ${tag}`,
      phone: "5551234567",
    });
    leadIds.push(lead.id);
    return lead;
  }

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    savedMode = settings.leadAssignmentMode;
    savedPersonId = settings.leadAssignmentUserId;
    savedCursor = settings.leadRotationCursor;
    const mkUser = async (email: string, role: "ADMIN" | "STAFF", jobRoleId?: string) => {
      const user = await prisma.user.create({
        data: { email, name: email, role, jobRoleId: jobRoleId ?? null },
      });
      userIds.push(user.id);
      return user.id;
    };
    admin1Id = await mkUser(`assign-${tag}-admin1@example.com`, "ADMIN");
    admin2Id = await mkUser(`assign-${tag}-admin2@example.com`, "ADMIN");
    staffId = await mkUser(`assign-${tag}-staff@example.com`, "STAFF");
    // A job role that hides the Leads screen: this admin can never own a lead.
    const role = await prisma.jobRole.create({
      data: { label: `No leads ${tag}`, accessLevel: "ADMIN", screens: ["customers"] },
    });
    jobRoleId = role.id;
    blockedAdminId = await mkUser(`assign-${tag}-blocked@example.com`, "ADMIN", jobRoleId);
    // Staff with the Leads screen can be given leads; staff whose role hides
    // it cannot (answered by Chris 2026-10-26, DQ-LD1-1).
    const leadsRole = await prisma.jobRole.create({
      data: { label: `Leads ${tag}`, accessLevel: "STAFF", screens: ["leads", "customers"] },
    });
    staffLeadsRoleId = leadsRole.id;
    staffLeadsId = await mkUser(`assign-${tag}-staff-leads@example.com`, "STAFF", staffLeadsRoleId);
    const noLeadsRole = await prisma.jobRole.create({
      data: { label: `No leads staff ${tag}`, accessLevel: "STAFF", screens: ["customers"] },
    });
    staffNoLeadsRoleId = noLeadsRole.id;
    staffNoLeadsId = await mkUser(
      `assign-${tag}-staff-noleads@example.com`,
      "STAFF",
      staffNoLeadsRoleId,
    );
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { OR: [{ entityId: { in: leadIds } }, { userId: { in: userIds } }] },
    });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.jobRole.deleteMany({
      where: { id: { in: [jobRoleId, staffLeadsRoleId, staffNoLeadsRoleId] } },
    });
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: {
        leadAssignmentMode: savedMode ?? "OWNER",
        leadAssignmentUserId: savedPersonId,
        leadRotationCursor: savedCursor,
      },
    });
  });

  it("OWNER mode gives every new lead to the oldest owner", async () => {
    await setMode("OWNER");
    const lead = await makeLead();
    expect(lead.assignedToUserId).toBe(ownerId);
  });

  it("PERSON mode gives every new lead to that person", async () => {
    await setMode("PERSON", admin1Id);
    const lead = await makeLead();
    expect(lead.assignedToUserId).toBe(admin1Id);
  });

  it("PERSON falls back to the owner when the person can no longer be given leads", async () => {
    await setMode("PERSON", admin1Id);
    await prisma.user.update({ where: { id: admin1Id }, data: { archivedAt: new Date() } });
    try {
      const lead = await makeLead();
      expect(lead.assignedToUserId).toBe(ownerId);
    } finally {
      await prisma.user.update({ where: { id: admin1Id }, data: { archivedAt: null } });
    }
  });

  it("ROTATE shares leads fairly over the assignable people, in order", async () => {
    await setMode("ROTATE", null, null);
    const people = (
      await prisma.$transaction((tx) => assignableLeadOwners(tx))
    ).map((o) => o.id);
    expect(people.length).toBeGreaterThanOrEqual(3);
    // Back-to-back picks: each runner has its own throwaway database, so no
    // other file's lead can take a turn mid-sequence here.
    const picks: string[] = [];
    for (let i = 0; i < people.length * 3; i++) {
      picks.push((await prisma.$transaction((tx) => chooseOwnerForNewLeadInTx(tx)))!);
    }
    expect(new Set(picks)).toEqual(new Set(people));
    for (const person of people) {
      expect(picks.filter((p) => p === person)).toHaveLength(3);
    }
    for (let i = 1; i < picks.length; i++) {
      expect(picks[i]).not.toBe(picks[i - 1]);
    }
  });

  it("concurrent creates in ROTATE give different people", async () => {
    await setMode("ROTATE", null, null);
    const [a, b] = await Promise.all([makeLead(), makeLead()]);
    expect(a.assignedToUserId).not.toBe(b.assignedToUserId);
  });

  it("staff with the Leads screen are assignable; staff whose role hides leads are not", async () => {
    const owners = await prisma.$transaction((tx) => assignableLeadOwners(tx));
    const ids = owners.map((o) => o.id);
    expect(ids).toContain(ownerId);
    expect(ids).toContain(admin1Id);
    expect(ids).not.toContain(blockedAdminId);
    // No job role: the access level decides, so staff with no role are
    // assignable just like an owner or admin with no role.
    expect(ids).toContain(staffId);
    expect(ids).toContain(staffLeadsId);
    expect(ids).not.toContain(staffNoLeadsId);
    const lead = await makeLead();
    await expect(reassignLead(ownerId, lead.id, blockedAdminId)).rejects.toThrow(
      /can't be given leads/,
    );
    await expect(reassignLead(ownerId, lead.id, staffNoLeadsId)).rejects.toThrow(
      /can't be given leads/,
    );
    await reassignLead(ownerId, lead.id, staffLeadsId);
    expect(
      (await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).assignedToUserId,
    ).toBe(staffLeadsId);
  });

  it("reassign moves a lead and audits the move", async () => {
    await setMode("OWNER");
    const lead = await makeLead();
    expect(lead.assignedToUserId).toBe(ownerId);
    await reassignLead(ownerId, lead.id, admin2Id);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).assignedToUserId).toBe(
      admin2Id,
    );
    const audit = await prisma.auditLog.findFirst({
      where: { action: "lead.assign", entityId: lead.id },
    });
    expect(audit?.newValue).toMatchObject({ assignedToUserId: admin2Id });
    await reassignLead(ownerId, lead.id, null);
    expect(
      (await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).assignedToUserId,
    ).toBeNull();
  });

  it("saving the assignment refuses a stale page and a non-owner", async () => {
    await saveLeadAssignment(ownerId, { mode: "PERSON", personId: admin1Id }, { mode: "OWNER", personId: null });
    await expect(
      saveLeadAssignment(
        ownerId,
        { mode: "ROTATE", personId: null },
        { mode: "OWNER", personId: null },
      ),
    ).rejects.toThrow(/changed in another session/);
    await expect(
      saveLeadAssignment(
        staffId,
        { mode: "OWNER", personId: null },
        { mode: "PERSON", personId: admin1Id },
      ),
    ).rejects.toThrow(/no longer has access/);
    await setMode("OWNER");
  });
});
