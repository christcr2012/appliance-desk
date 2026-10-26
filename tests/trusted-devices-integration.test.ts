import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Capture the codes and notices that would be emailed or texted.
const { sent, sendSmsMock } = vi.hoisted(() => ({
  sent: [] as { to: string; subject: string; text: string }[],
  sendSmsMock: vi.fn(async () => ({ sent: false, outcome: "NOT_ATTEMPTED" })),
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async (m: { to: string; subject: string; text: string }) => { sent.push(m); return { sent: true, outcome: "SENT" }; }) }));
vi.mock("@/lib/sms", () => ({ sendSms: sendSmsMock }));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { createTrustedCredentialUserInTx } from "@/lib/account-provisioning";
import { finishPasswordChange } from "@/domains/account";
import { changeAccessLevel, removeTeamMember, resetTeamSignIn } from "@/domains/team";
import { revokeOtherSessions, revokeStaffSessionsByOwner } from "@/domains/security/sessions";
import { confirmMethodSwitch, getMethodSettings, setMethodSettings, startMethodSwitch } from "@/domains/security/second-step";
import { setCustomerEmailEnabled } from "@/domains/settings/customer-email-switch";
import {
  getTrustedDeviceSettings, listOwnKnownDevices, updateTrustedDeviceSettings,
} from "@/domains/security/trusted-devices";

// ACC-6 on real Postgres: ticking "Remember this device" skips the code on that device for the owner's days and
// never longer, a hand-made trust request is ignored when remembering is off or for a customer, and every security
// change (password, reset, second-step change, removal, role change, sign-out-everywhere, lowering the setting)
// asks for a code again.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";
const PASSWORD = "Acc6-Test-Password-2026!";
const DAY_MS = 24 * 60 * 60 * 1000;

type SignInResult = { headers: Headers; response: { twoFactorRedirect?: boolean; user?: { id: string; email: string } } };

function cookiesFrom(headers: Headers): string {
  return headers.getSetCookie().map((c) => c.split(";")[0]!).join("; ");
}

function cookieValue(jar: string, name: string): string | null {
  const hit = jar.split("; ").find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

/** One "name=value" pair from a cookie jar, matched by the end of the name (the library prefixes its cookies). */
function cookieBySuffix(jar: string, suffix: string): string | null {
  return jar.split("; ").find((c) => c.split("=")[0]!.endsWith(suffix)) ?? null;
}

/** Only the trust and device cookies from a jar: what the next password sign-in presents. */
// The cookies a real browser would present on the next password sign-in: the trust cookie from the latest
// response (it rotates on every trusted sign-in, so a stale jar points at a deleted row) plus the device
// cookie in force (the server only sets it when it is new, so it is not in every jar). The device cookie
// is null when the verify did not set or receive one.
function signInCookies(jar: string, deviceCookie?: string | null): string {
  const parts = [cookieBySuffix(jar, "trust_device")];
  parts.push(deviceCookie ? `ad_device=${deviceCookie}` : cookieBySuffix(jar, "ad_device"));
  return parts.filter(Boolean).join("; ");
}

describe.skipIf(!enabled)("Remember this device on real Postgres", () => {
  const tag = randomUUID().slice(0, 8);
  const ids = { owner: "", staffA: "", staffB: "", staffC: "", staffNotice: "", customer2fa: "", customerPlain: "" };
  const email = (who: string) => `${tag}-${who}@example.test`.toLowerCase();
  // The app stores every email lowercased (normalizeAccountEmail), so the fixture addresses must be
  // lowercase too: a mixed-case address (staffA) is stored as staffa, and the test's exact-match
  // lookups for the code email and the signed-in address would otherwise miss every time.
  let before: {
    trustedDeviceDays: number | null; customerEmailEnabled: boolean | null;
    secondStepMethodsByLevel: unknown; securitySmsEnabled: boolean | null;
  } | null = null;

  /** The most recent code emailed to someone (notices to the same address carry no code). */
  const lastCodeFor = (to: string) => {
    for (const m of [...sent.filter((m) => m.to === to)].reverse()) {
      const hit = /is (\d{6})\./.exec(m.text)?.[1];
      if (hit) return hit;
    }
    return "";
  };

  async function signInPassword(who: string, cookie = "") {
    const res = await auth.api.signInEmail({
      body: { email: email(who), password: PASSWORD },
      ...(cookie ? { headers: new Headers({ cookie }) } : {}),
      returnHeaders: true,
    }) as unknown as SignInResult;
    return res;
  }

  /**
   * Sign in with the password, get the emailed code, and verify it. deviceCookie may be null (no device cookie
   * on the request: the follow-up sets one). Returns the cookies the verify set and the device cookie in force.
   */
  async function verifyWithOtp(who: string, deviceCookie: string | null, trustDevice: boolean) {
    const signIn = await signInPassword(who, deviceCookie ? `ad_device=${deviceCookie}` : "");
    expect(signIn.response.twoFactorRedirect, `${who} is asked for a code`).toBe(true);
    const twoFaCookie = cookiesFrom(signIn.headers);
    expect(cookieBySuffix(twoFaCookie, "two_factor"), "a second-step challenge cookie is set").toBeTruthy();
    await auth.api.sendTwoFactorOTP({ headers: new Headers({ cookie: twoFaCookie }), body: {} });
    const code = lastCodeFor(email(who));
    expect(code, `a code reaches ${who}`).toMatch(/^\d{6}$/);
    const cookie = deviceCookie ? `${twoFaCookie}; ad_device=${deviceCookie}` : twoFaCookie;
    const verify = await auth.api.verifyTwoFactorOTP({
      headers: new Headers({ cookie }),
      body: { code, trustDevice },
      returnHeaders: true,
    }) as unknown as SignInResult;
    expect(verify.response.user?.email, `${who} is signed in after the code`).toBe(email(who));
    const jar = cookiesFrom(verify.headers);
    return { jar, deviceCookie: deviceCookie ?? cookieValue(jar, "ad_device") };
  }

  async function trustDeviceRows(userId: string) {
    const device = await prisma.knownDevice.findFirst({ where: { userId }, orderBy: { lastSeenAt: "desc" } });
    const trust = await prisma.verification.findFirst({
      where: { identifier: { startsWith: "trust-device-" }, value: userId },
      orderBy: { createdAt: "desc" },
    });
    return { device, trust };
  }

  async function expectForgotten(userId: string) {
    const { device, trust } = await trustDeviceRows(userId);
    expect(trust, "no trust row survives").toBeNull();
    expect(device?.trustedUntil, "the device is no longer remembered").toBeNull();
  }

  beforeAll(async () => {
    before = await prisma.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { trustedDeviceDays: true, customerEmailEnabled: true, secondStepMethodsByLevel: true, securitySmsEnabled: true },
    });
    const make = async (who: string, role: "OWNER" | "ADMIN" | "STAFF" | "CUSTOMER", twoFactor: boolean) => {
      const user = await prisma.$transaction((tx) => createTrustedCredentialUserInTx(tx, { email: email(who), name: who, role, password: PASSWORD }));
      if (twoFactor) {
        await prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true, secondStepMethod: "EMAIL" } });
      }
      return user.id;
    };
    ids.owner = await make("owner", "OWNER", true);
    ids.staffA = await make("staffA", "STAFF", true);
    ids.staffB = await make("staffB", "STAFF", true);
    ids.staffC = await make("staffC", "STAFF", true);
    ids.staffNotice = await make("staffNotice", "STAFF", true);
    ids.customer2fa = await make("customer2fa", "CUSTOMER", true);
    ids.customerPlain = await make("customerPlain", "CUSTOMER", false);
    // A confirmed phone, so the method-switch test can move between email and text codes.
    await prisma.user.update({ where: { id: ids.staffA }, data: { phone: "+19705550199", phoneConfirmedAt: new Date() } });
  });
  beforeEach(() => { sent.length = 0; sendSmsMock.mockClear(); });
  afterEach(async () => {
    // Every test restores the shared settings it may have changed, so tests stay independent.
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { trustedDeviceDays: 30, customerEmailEnabled: false, securitySmsEnabled: false },
    });
    sendSmsMock.mockResolvedValue({ sent: false, outcome: "NOT_ATTEMPTED" } as never);
  });
  afterAll(async () => {
    const mine = await prisma.user.findMany({ where: { email: { startsWith: tag } }, select: { id: true } });
    const userIds = mine.map((u) => u.id);
    await prisma.verification.deleteMany({ where: { OR: userIds.map((id) => ({ identifier: { contains: id } })) } });
    await prisma.verification.deleteMany({ where: { value: { in: userIds } } });
    await prisma.knownDevice.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { entityId: { in: userIds } }] } });
    await prisma.twoFactor.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.teamInvitation.deleteMany({ where: { email: { startsWith: tag } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (before) {
      await prisma.businessSettings.update({
        where: { id: "singleton" },
        data: {
          trustedDeviceDays: before.trustedDeviceDays ?? 30,
          customerEmailEnabled: before.customerEmailEnabled ?? false,
          secondStepMethodsByLevel: before.secondStepMethodsByLevel as object,
          securitySmsEnabled: before.securitySmsEnabled ?? false,
        },
      });
    }
  });

  it("only the owner changes the remember-days setting", async () => {
    expect((await getTrustedDeviceSettings()).days).toBe(30);
    await expect(updateTrustedDeviceSettings(ids.staffA, { days: 7 })).rejects.toThrow();
    expect(await updateTrustedDeviceSettings(ids.owner, { days: 7 })).toEqual({ days: 7 });
    expect((await getTrustedDeviceSettings()).days).toBe(7);
    await expect(updateTrustedDeviceSettings(ids.owner, { days: 91 })).rejects.toThrow();
    expect(await updateTrustedDeviceSettings(ids.owner, { days: 30 })).toEqual({ days: 30 });
  });

  it("ticking Remember this device skips the code on that device, and only until the days run out", async () => {
    // No device cookie on the request: the follow-up sets one.
    const { jar, deviceCookie } = await verifyWithOtp("staffA", null, true);
    expect(cookieBySuffix(jar, "trust_device"), "a trust cookie is set").toBeTruthy();
    expect(deviceCookie, "a device cookie is set").toMatch(/^[A-Za-z0-9_-]{43}$/);
    const { device, trust } = await trustDeviceRows(ids.staffA);
    expect(device?.label).toBe("Unknown device");
    expect(device?.trustedUntil?.getTime()).toBeGreaterThan(Date.now() + 29 * DAY_MS);
    expect(device?.trustedUntil?.getTime()).toBeLessThanOrEqual(Date.now() + 30 * DAY_MS);
    // The library's row is clamped to the same date, not its 90-day ceiling.
    expect(trust?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * DAY_MS);
    expect(trust?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * DAY_MS);
    expect(await listOwnKnownDevices(ids.staffA)).toHaveLength(1);
    expect((await listOwnKnownDevices(ids.staffA))[0]?.trustedUntil).not.toBeNull();

    // The next sign-in on the same device skips the code.
    const again = await signInPassword("staffA", signInCookies(jar, deviceCookie));
    expect(again.response.twoFactorRedirect, "the code is skipped").toBeUndefined();
    expect(again.response.user?.email).toBe(email("staffA"));

    // Once the remembered-until date has passed, the code is asked for again (and the trust row is gone).
    await prisma.knownDevice.update({ where: { id: device!.id }, data: { trustedUntil: new Date(Date.now() - 1000) } });
    // The trust cookie rotated at the skipped sign-in, so the stale verify jar points at a deleted row; the
    // gate must see the current trust cookie (from the skipped sign-in) with the same device cookie.
    const expired = await signInPassword("staffA", signInCookies(cookiesFrom(again.headers), deviceCookie));
    expect(expired.response.twoFactorRedirect, "the code is asked for again").toBe(true);
    expect((await trustDeviceRows(ids.staffA)).trust).toBeNull();
  });

  it("rotation never extends a remembered device past its remembered-until date", async () => {
    const { jar, deviceCookie } = await verifyWithOtp("staffA", "acc6-device-rot", true);
    await updateTrustedDeviceSettings(ids.owner, { days: 7 });
    const shortened = await trustDeviceRows(ids.staffA);
    expect(shortened.device?.trustedUntil?.getTime()).toBeGreaterThan(Date.now() + 6 * DAY_MS);
    expect(shortened.device?.trustedUntil?.getTime()).toBeLessThanOrEqual(Date.now() + 7 * DAY_MS);
    expect(shortened.trust?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 7 * DAY_MS);

    // Signing in again rotates the trust row; it must stay at the shortened date, not 7 more days.
    // The verify response sets no device cookie (one was already presented), so it is passed along.
    const again = await signInPassword("staffA", signInCookies(jar, deviceCookie));
    expect(again.response.twoFactorRedirect, "the code is still skipped").toBeUndefined();
    const rotated = await trustDeviceRows(ids.staffA);
    expect(rotated.trust?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 7 * DAY_MS);
    expect(rotated.device?.trustedUntil?.getTime()).toBeLessThanOrEqual(Date.now() + 7 * DAY_MS);
    expect(rotated.device?.trustedUntil?.getTime()).toBeGreaterThan(Date.now() + 6 * DAY_MS);
  });

  it("lowering the setting shortens every remembered device, and 0 forgets them all", async () => {
    const { jar } = await verifyWithOtp("staffA", "acc6-device-low", true);
    expect(cookieBySuffix(jar, "trust_device")).toBeTruthy();
    await updateTrustedDeviceSettings(ids.owner, { days: 7 });
    const shortened = await trustDeviceRows(ids.staffA);
    expect(shortened.device?.trustedUntil?.getTime()).toBeLessThanOrEqual(Date.now() + 7 * DAY_MS);
    expect(shortened.trust?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 7 * DAY_MS);
    await updateTrustedDeviceSettings(ids.owner, { days: 0 });
    await expectForgotten(ids.staffA);
    const again = await signInPassword("staffA", signInCookies(jar));
    expect(again.response.twoFactorRedirect, "the code is asked for again").toBe(true);
  });

  it("setting 0 ignores a hand-made trust request", async () => {
    await updateTrustedDeviceSettings(ids.owner, { days: 0 });
    const { jar } = await verifyWithOtp("staffA", "acc6-device-off", true);
    expect(cookieBySuffix(jar, "trust_device"), "no trust cookie is set").toBeNull();
    await expectForgotten(ids.staffA);
    const again = await signInPassword("staffA", signInCookies(jar));
    expect(again.response.twoFactorRedirect, "the code is asked for again").toBe(true);
  });

  it("a customer cannot remember a device", async () => {
    const { jar } = await verifyWithOtp("customer2fa", "acc6-device-cust", true);
    expect(cookieBySuffix(jar, "trust_device"), "no trust cookie is set").toBeNull();
    await expectForgotten(ids.customer2fa);
    const again = await signInPassword("customer2fa", signInCookies(jar));
    expect(again.response.twoFactorRedirect, "the code is asked for again").toBe(true);
  });

  it("a changed password, a reset, a second-step change and signing out everywhere each ask for a code again", async () => {
    // Password change.
    let { jar } = await verifyWithOtp("staffA", "acc6-device-pw", true);
    await finishPasswordChange(ids.staffA, "current-token", false, async () => 0);
    await expectForgotten(ids.staffA);
    expect((await signInPassword("staffA", signInCookies(jar))).response.twoFactorRedirect).toBe(true);

    // Forgotten-password reset.
    ({ jar } = await verifyWithOtp("staffA", "acc6-device-pw", true));
    const hook = (auth.options.emailAndPassword as unknown as { onPasswordReset?: (d: { user: { id: string } }) => Promise<void> }).onPasswordReset!;
    await hook({ user: { id: ids.staffA } });
    await expectForgotten(ids.staffA);
    expect((await signInPassword("staffA", signInCookies(jar))).response.twoFactorRedirect).toBe(true);

    // Second-step change (email codes to text codes and back, with the text switch on for the move).
    ({ jar } = await verifyWithOtp("staffA", "acc6-device-pw", true));
    const policy = (await getMethodSettings()).policy;
    await setMethodSettings(ids.owner, { policy, securitySmsEnabled: true });
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "x");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "x");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+10000000000");
    sendSmsMock.mockResolvedValue({ sent: true, outcome: "SENT" } as never);
    try {
      await startMethodSwitch(ids.staffA, "SMS");
      const smsCalls = sendSmsMock.mock.calls as unknown as { body: string }[][];
      const smsCode = /is (\d{6})\./.exec(smsCalls.at(-1)?.[0]?.body ?? "")?.[1];
      expect(smsCode).toMatch(/^\d{6}$/);
      await confirmMethodSwitch(ids.staffA, "SMS", smsCode!);
      await expectForgotten(ids.staffA);
      expect((await signInPassword("staffA", signInCookies(jar))).response.twoFactorRedirect).toBe(true);
      // Back to email codes, so later tests see the usual method.
      await startMethodSwitch(ids.staffA, "EMAIL");
      await confirmMethodSwitch(ids.staffA, "EMAIL", lastCodeFor(email("staffA")));
    } finally {
      vi.unstubAllEnvs();
      sendSmsMock.mockResolvedValue({ sent: false, outcome: "NOT_ATTEMPTED" } as never);
      await setMethodSettings(ids.owner, { policy, securitySmsEnabled: false });
    }

    // The owner signing this person out everywhere.
    ({ jar } = await verifyWithOtp("staffA", "acc6-device-pw", true));
    await revokeStaffSessionsByOwner(ids.owner, ids.staffA);
    await expectForgotten(ids.staffA);
    expect((await signInPassword("staffA", signInCookies(jar))).response.twoFactorRedirect).toBe(true);

    // Signing out my other devices from My account.
    ({ jar } = await verifyWithOtp("staffA", "acc6-device-pw", true));
    // The session cookie is signed, so its value is not the token the session row stores; read the row.
    const session = await prisma.session.findFirst({ where: { userId: ids.staffA }, orderBy: { createdAt: "desc" }, select: { token: true } });
    expect(session?.token, "the verify set a session").toBeTruthy();
    await revokeOtherSessions(ids.staffA, session!.token);
    await expectForgotten(ids.staffA);
    expect((await signInPassword("staffA", signInCookies(jar))).response.twoFactorRedirect).toBe(true);
  });

  it("a role change and an owner's reset each ask for a code again, and removal forgets the device", async () => {
    // Role change (staff to admin): the person can still sign in, but must prove a code.
    let { jar } = await verifyWithOtp("staffB", "acc6-device-role", true);
    await changeAccessLevel(ids.owner, ids.staffB, "ADMIN");
    await expectForgotten(ids.staffB);
    expect((await signInPassword("staffB", signInCookies(jar))).response.twoFactorRedirect).toBe(true);

    // Owner's reset: the old password stops working, so only the rows are checked.
    ({ jar } = await verifyWithOtp("staffB", "acc6-device-role", true));
    await resetTeamSignIn(ids.owner, ids.staffB);
    await expectForgotten(ids.staffB);

    // Removal: a remembered device is forgotten with the access.
    await verifyWithOtp("staffC", "acc6-device-remove", true);
    await removeTeamMember(ids.owner, ids.staffC);
    await expectForgotten(ids.staffC);
  });

  it("the first sign-in on a device is only recorded; a second phone of the same kind is new", async () => {
    const first = await verifyWithOtp("staffNotice", "acc6-device-n1", false);
    expect(first.deviceCookie).toBe("acc6-device-n1");
    expect(sent.filter((m) => m.subject === "New sign-in to your account")).toHaveLength(0);

    await verifyWithOtp("staffNotice", "acc6-device-n2", false);
    const notices = sent.filter((m) => m.subject === "New sign-in to your account");
    expect(notices).toHaveLength(1);
    expect(notices[0]!.to).toBe(email("staffNotice"));
    expect(notices[0]!.text).not.toMatch(/https?:\/\//);
  });

  it("a customer gets the new-device notice only through the customer-email switch", async () => {
    const signInPlain = async (deviceCookie: string) => {
      const res = await signInPassword("customerPlain", `ad_device=${deviceCookie}`);
      expect(res.response.twoFactorRedirect, "a customer signs in with password only").toBeUndefined();
      expect(res.response.user?.email).toBe(email("customerPlain"));
    };
    await signInPlain("acc6-cust-1");
    expect(sent.filter((m) => m.subject === "New sign-in to your account")).toHaveLength(0);
    await signInPlain("acc6-cust-2");
    expect(sent.filter((m) => m.to === email("customerPlain"))).toHaveLength(0);
    const notSent = await prisma.auditLog.findFirst({
      where: { userId: ids.customerPlain, action: "account.notice_not_sent" },
      orderBy: { createdAt: "desc" },
    });
    expect(notSent?.newValue).toMatchObject({ notice: "new_device", outcome: "NOT_ATTEMPTED" });

    await setCustomerEmailEnabled(ids.owner, true);
    await signInPlain("acc6-cust-3");
    const notices = sent.filter((m) => m.subject === "New sign-in to your account" && m.to === email("customerPlain"));
    expect(notices).toHaveLength(1);
    expect(notices[0]!.text).not.toMatch(/https?:\/\//);
  });
});
