import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Capture the codes that would be emailed; text must never be attempted while the switch is off.
const { sent, sendSmsMock } = vi.hoisted(() => ({
  sent: [] as { to: string; text: string }[],
  sendSmsMock: vi.fn(async () => ({ sent: false, outcome: "NOT_ATTEMPTED" })),
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async (m: { to: string; text: string }) => { sent.push(m); return { sent: true, outcome: "SENT" }; }) }));
vi.mock("@/lib/sms", () => ({ sendSms: sendSmsMock }));

import { prisma } from "@/lib/prisma";
import {
  SecondStepError, chooseSecondStepMethod, confirmMethodSwitch, deliverSignInCode, getMethodSettings, getSecondStepView,
  setMethodSettings, startMethodSwitch, startPhoneConfirmation,
} from "@/domains/security/second-step";
import { RECOMMENDED_METHOD_POLICY } from "@/domains/security/second-step-rules";

// ACC-3 on real Postgres: the rules the owner sets are enforced on the server, codes expire and cannot be reused,
// and text is never attempted while the owner's switch is off.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("Sign-in code methods on real Postgres", () => {
  const tag = randomUUID().slice(0, 8);
  const ids = { owner: `acc3-owner-${tag}`, admin: `acc3-admin-${tag}`, staff: `acc3-staff-${tag}`, totp: `acc3-totp-${tag}` };
  const email = (who: string) => `${tag}-${who}@example.test`;
  let before: { secondStepMethodsByLevel: unknown; securitySmsEnabled: boolean } | null = null;
  const lastCode = () => /is (\d{6})\./.exec(sent[sent.length - 1]?.text ?? "")?.[1] ?? "";
  const resetCooldown = (userId: string) => prisma.verification.updateMany({ where: { identifier: { contains: userId } }, data: { createdAt: new Date(Date.now() - 120_000) } });

  beforeAll(async () => {
    before = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { secondStepMethodsByLevel: true, securitySmsEnabled: true } });
    await prisma.user.create({ data: { id: ids.owner, name: "Owner", email: email("owner"), role: "OWNER", emailVerified: true } });
    await prisma.user.create({ data: { id: ids.admin, name: "Admin", email: email("admin"), role: "ADMIN", emailVerified: true } });
    await prisma.user.create({ data: { id: ids.staff, name: "Staff", email: email("staff"), role: "STAFF", emailVerified: true, twoFactorEnabled: true, secondStepMethod: "TOTP", phone: "+19705550123" } });
    await prisma.user.create({ data: { id: ids.totp, name: "Totp", email: email("totp"), role: "STAFF", emailVerified: true } });
    await setMethodSettings(ids.owner, { policy: RECOMMENDED_METHOD_POLICY, securitySmsEnabled: false });
  });
  beforeEach(() => { sent.length = 0; sendSmsMock.mockClear(); });
  afterAll(async () => {
    const userIds = Object.values(ids);
    await prisma.verification.deleteMany({ where: { OR: userIds.map((id) => ({ identifier: { contains: id } })) } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { entityId: { in: userIds } }] } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (before) await prisma.businessSettings.update({ where: { id: "singleton" }, data: { secondStepMethodsByLevel: before.secondStepMethodsByLevel as object, securitySmsEnabled: before.securitySmsEnabled } });
  });

  it("only the owner changes the rules; the authenticator app can never be removed; the text switch starts off", async () => {
    expect((await getMethodSettings()).securitySmsEnabled).toBe(false);
    await expect(setMethodSettings(ids.admin, { policy: {}, securitySmsEnabled: true })).rejects.toThrow();
    const saved = await setMethodSettings(ids.owner, { policy: { OWNER: [], ADMIN: ["EMAIL"], STAFF: ["EMAIL"] }, securitySmsEnabled: false });
    expect(saved.OWNER).toEqual(["TOTP"]);
    expect(saved.ADMIN).toEqual(["TOTP", "EMAIL"]);
    expect(await prisma.auditLog.count({ where: { userId: ids.owner, action: "security.second_step_policy" } })).toBeGreaterThanOrEqual(2);
    await setMethodSettings(ids.owner, { policy: RECOMMENDED_METHOD_POLICY, securitySmsEnabled: false });
  });

  it("a method the owner's rules forbid, or text while it is switched off, cannot be chosen", async () => {
    await expect(chooseSecondStepMethod(ids.owner, "EMAIL")).rejects.toThrow("not allowed");
    await expect(chooseSecondStepMethod(ids.admin, "EMAIL")).rejects.toThrow("not allowed");
    await expect(chooseSecondStepMethod(ids.totp, "SMS")).rejects.toThrow("not switched on");
    await expect(chooseSecondStepMethod(ids.totp, "carrier-pigeon")).rejects.toThrow(SecondStepError);
    await expect(chooseSecondStepMethod(ids.staff, "EMAIL")).rejects.toThrow("already on");
    expect(await chooseSecondStepMethod(ids.totp, "EMAIL")).toBe("EMAIL");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.totp } })).secondStepMethod).toBe("EMAIL");
  });

  it("delivers a sign-in code only by the stored choice, never writes the code down, and never texts while the switch is off", async () => {
    expect(await deliverSignInCode({ id: ids.staff }, "123456")).toBe("NOT_ATTEMPTED"); // authenticator user gets nothing
    expect(sent).toHaveLength(0);
    expect(await deliverSignInCode({ id: ids.totp }, "654321")).toBe("SENT");
    expect(sent[0]).toMatchObject({ to: email("totp") });
    expect(sent[0]!.text).toContain("654321");
    await prisma.user.update({ where: { id: ids.totp }, data: { secondStepMethod: "SMS", phone: "+19705550199", phoneConfirmedAt: new Date() } });
    expect(await deliverSignInCode({ id: ids.totp }, "111111")).toBe("NOT_ATTEMPTED");
    expect(sendSmsMock).not.toHaveBeenCalled();
    const rows = await prisma.auditLog.findMany({ where: { userId: { in: [ids.staff, ids.totp] }, action: "security.sign_in_code" } });
    expect(JSON.stringify(rows)).not.toMatch(/654321|111111|123456/);
    await prisma.user.update({ where: { id: ids.totp }, data: { secondStepMethod: null, phone: null, phoneConfirmedAt: null } });
  });

  it("a phone cannot be checked while text codes are switched off", async () => {
    await expect(startPhoneConfirmation(ids.staff)).rejects.toThrow("not switched on");
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it("switching method needs a working code: wrong tries are counted, a good code works once, a resend waits a minute", async () => {
    expect(await startMethodSwitch(ids.staff, "EMAIL")).toBe("SENT");
    await expect(startMethodSwitch(ids.staff, "EMAIL")).rejects.toThrow("Wait a minute");
    const code = lastCode();
    expect(code).toMatch(/^\d{6}$/);
    await expect(confirmMethodSwitch(ids.staff, "EMAIL", code === "000000" ? "111111" : "000000")).rejects.toThrow("not accepted");
    await confirmMethodSwitch(ids.staff, "EMAIL", code);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.staff } })).secondStepMethod).toBe("EMAIL");
    await expect(confirmMethodSwitch(ids.staff, "EMAIL", code)).rejects.toThrow("not accepted"); // already used
  });

  it("an expired code, or one tried too often, is refused; the owner cannot switch to a forbidden method", async () => {
    await prisma.user.update({ where: { id: ids.staff }, data: { secondStepMethod: "TOTP" } });
    await resetCooldown(ids.staff);
    await startMethodSwitch(ids.staff, "EMAIL");
    const good = lastCode();
    await prisma.verification.updateMany({ where: { identifier: { contains: ids.staff } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(confirmMethodSwitch(ids.staff, "EMAIL", good)).rejects.toThrow("not accepted");

    await resetCooldown(ids.staff);
    await startMethodSwitch(ids.staff, "EMAIL");
    const real = lastCode();
    const wrong = real === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await expect(confirmMethodSwitch(ids.staff, "EMAIL", wrong)).rejects.toThrow();
    await expect(confirmMethodSwitch(ids.staff, "EMAIL", real)).rejects.toThrow("Too many");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.staff } })).secondStepMethod).toBe("TOTP");

    await prisma.user.update({ where: { id: ids.owner }, data: { twoFactorEnabled: true, secondStepMethod: "TOTP" } });
    await expect(startMethodSwitch(ids.owner, "EMAIL")).rejects.toThrow("not allowed");
  });

  it("changing the rules never changes anyone's current method; they are told to switch", async () => {
    await prisma.user.update({ where: { id: ids.staff }, data: { secondStepMethod: "EMAIL" } });
    await setMethodSettings(ids.owner, { policy: { OWNER: [], ADMIN: [], STAFF: [] }, securitySmsEnabled: false });
    const view = await getSecondStepView(ids.staff);
    expect(view.method).toBe("EMAIL");
    expect(view.methodNotAllowedAnymore).toBe(true);
    expect(await deliverSignInCode({ id: ids.staff }, "222222")).toBe("SENT"); // still works
    await setMethodSettings(ids.owner, { policy: RECOMMENDED_METHOD_POLICY, securitySmsEnabled: false });
  });
});
