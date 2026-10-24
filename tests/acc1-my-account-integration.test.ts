import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { AccountError, completeEmailChange, finishPasswordChange, getMyAccount, noticeWarning, recordAccountEvent, updateMyProfile } from "@/domains/account";

// ACC-1 on real Postgres: My account changes only the signed-in person's own row, records every change, and fails closed.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("My account on real Postgres", () => {
  const tag = randomUUID().slice(0, 8);
  const ids = { admin: `acc1-admin-${tag}`, staff: `acc1-staff-${tag}`, gone: `acc1-gone-${tag}` };
  const email = (who: string) => `${tag}-${who}@example.test`;

  beforeAll(async () => {
    await prisma.user.create({ data: { id: ids.admin, name: "Acc Admin", email: email("admin"), role: "ADMIN", emailVerified: true } });
    await prisma.user.create({ data: { id: ids.staff, name: "Acc Staff", email: email("staff"), role: "STAFF", emailVerified: true } });
    await prisma.user.create({ data: { id: ids.gone, name: "Acc Gone", email: email("gone"), role: "STAFF", emailVerified: true, archivedAt: new Date() } });
  });
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  });

  it("shows only the person's own details, and says which roles must keep two-step on", async () => {
    const admin = await getMyAccount(ids.admin);
    expect(Object.keys(admin).sort()).toEqual(["email", "name", "phone", "phoneConfirmed", "role", "twoFactorEnabled", "twoFactorRequired"]);
    expect(admin.email).toBe(email("admin"));
    expect(admin.twoFactorRequired).toBe(true);
    expect((await getMyAccount(ids.staff)).twoFactorRequired).toBe(false);
    await expect(getMyAccount(ids.gone)).rejects.toThrow(AccountError);
    await expect(getMyAccount("no-such-user")).rejects.toThrow(AccountError);
  });

  it("saves name and phone to the caller's own row only, resets confirmation, and records it", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: ids.staff }, select: { name: true, phone: true } });
    const saved = await updateMyProfile(ids.admin, { name: "  New   Admin ", phone: "970-555-0123" });
    expect(saved).toMatchObject({ changed: true, nameChanged: true, phoneChanged: true });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: ids.admin } });
    expect(row.name).toBe("New Admin");
    expect(row.phone).toBe("+19705550123");
    expect(row.phoneConfirmedAt).toBeNull();
    // someone else's row is untouched
    expect(await prisma.user.findUniqueOrThrow({ where: { id: ids.staff }, select: { name: true, phone: true } })).toEqual(before);
    const audit = await prisma.auditLog.findMany({ where: { userId: ids.admin, action: "account.profile_update" } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]!.newValue)).not.toContain("5550123"); // only the last four digits are kept
    expect((audit[0]!.newValue as { phoneEnding: string }).phoneEnding).toBe("0123");
  });

  it("does nothing, and records nothing, when nothing is different; a new phone clears 'confirmed'", async () => {
    expect(await updateMyProfile(ids.admin, { name: "New Admin", phone: "(970) 555-0123" })).toEqual({ changed: false, nameChanged: false, phoneChanged: false });
    await prisma.user.update({ where: { id: ids.admin }, data: { phoneConfirmedAt: new Date() } });
    expect((await getMyAccount(ids.admin)).phoneConfirmed).toBe(true);
    await updateMyProfile(ids.admin, { name: "New Admin", phone: "970-555-0199" });
    expect((await getMyAccount(ids.admin)).phoneConfirmed).toBe(false);
    expect(await prisma.auditLog.count({ where: { userId: ids.admin, action: "account.profile_update" } })).toBe(2);
    await updateMyProfile(ids.admin, { name: "New Admin", phone: "" });
    expect((await getMyAccount(ids.admin)).phone).toBeNull();
  });

  it("refuses bad input and a removed account before writing anything", async () => {
    await expect(updateMyProfile(ids.admin, { name: "", phone: "" })).rejects.toThrow(AccountError);
    await expect(updateMyProfile(ids.admin, { name: "Ok", phone: "12" })).rejects.toThrow(AccountError);
    await expect(updateMyProfile(ids.gone, { name: "Changed", phone: "" })).rejects.toThrow(/no longer has access/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.gone } })).name).toBe("Acc Gone");
  });

  it("two saves at the same moment both finish and leave one consistent row", async () => {
    await Promise.all([
      updateMyProfile(ids.staff, { name: "Race One", phone: "970-555-0111" }),
      updateMyProfile(ids.staff, { name: "Race Two", phone: "970-555-0222" }),
    ]);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: ids.staff } });
    expect([["Race One", "+19705550111"], ["Race Two", "+19705550222"]]).toContainEqual([row.name, row.phone]);
  });

  it("a notice email that was not confirmed sent is recorded and reported, and a failed device sign-out is never counted as 'no other devices'", async () => {
    // The disposable test database never sends real email, so every notice here is "not sent".
    expect(await noticeWarning(ids.admin, "password")).toMatch(/could not confirm/);
    const noted = await prisma.auditLog.findMany({ where: { userId: ids.admin, action: "account.notice_not_sent" } });
    expect(noted.map((row) => (row.newValue as { notice?: string } | null)?.notice)).toContain("password");

    const failed = await finishPasswordChange(ids.admin, "token", true, async () => { throw new Error("database unavailable"); });
    expect(failed).toMatchObject({ signedOut: 0, signOutFailed: true });
    expect(failed.warning).toBeTruthy();
    const worked = await finishPasswordChange(ids.admin, "token", true, async () => 3);
    expect(worked).toMatchObject({ signedOut: 3, signOutFailed: false });
    const skipped = await finishPasswordChange(ids.admin, "token", false, async () => { throw new Error("must not be called"); });
    expect(skipped).toMatchObject({ signedOut: 0, signOutFailed: false });

    const rows = await prisma.auditLog.findMany({ where: { userId: ids.admin, action: "account.password_changed" }, orderBy: { createdAt: "asc" } });
    expect(rows.map((row) => row.newValue)).toEqual([
      { signedOutOtherDevices: 0, otherDevicesSignOutFailed: true },
      { signedOutOtherDevices: 3, otherDevicesSignOutFailed: false },
      { signedOutOtherDevices: 0, otherDevicesSignOutFailed: false },
    ]);
  });

  it("finishing an email change we started is recorded once; an unrelated verification is ignored", async () => {
    const newEmail = email("moved");
    await completeEmailChange({ id: ids.admin, email: newEmail });
    expect(await prisma.auditLog.count({ where: { userId: ids.admin, action: "account.email_changed" } })).toBe(0);
    await recordAccountEvent(ids.admin, "account.email_change_requested", { newEmail, oldEmail: email("admin") });
    await completeEmailChange({ id: ids.admin, email: newEmail });
    await completeEmailChange({ id: ids.admin, email: newEmail });
    const done = await prisma.auditLog.findMany({ where: { userId: ids.admin, action: "account.email_changed" } });
    expect(done).toHaveLength(1);
    expect((done[0]!.newValue as { oldEmail: string }).oldEmail).toBe(email("admin"));
  });
});
