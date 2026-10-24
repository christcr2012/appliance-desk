import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { twoFactor } from "better-auth/plugins";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { prisma } from "./prisma";
import { sendEmail } from "./email";
import { sendPasswordEmail } from "./password-email";
import { decideAccountAuthPath, GUARDED_AUTH_PATHS } from "@/domains/account/policy";

function isDisposableCiAuthFixture(): boolean {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return process.env.CI === "true" && url.hostname === "localhost" &&
      url.pathname === "/appliance_desk_test";
  } catch { return false; }
}

// Central auth configuration. Roles are OWNER / ADMIN / CUSTOMER — see
// docs/BUSINESS-RULES.md for what each role can do. Every owner/admin
// route and every customer-ownership check is enforced on the SERVER
// (in this file, in src/proxy.ts, and in each server action) — never
// only by hiding a button in the UI.
export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  plugins: [
    twoFactor({
      issuer: "Robinson Appliance Rentals",
      // ACC-3: 6-digit codes that work 5 minutes, stored scrambled, 5 tries. WHERE a code goes is decided by the person's
      // stored choice (src/domains/security/second-step.ts), never by anything the browser sends.
      otpOptions: {
        digits: 6,
        period: 5,
        storeOTP: "hashed",
        allowedAttempts: 5,
        sendOTP: async ({ user, otp }) => {
          const { deliverSignInCode } = await import("@/domains/security/second-step");
          await deliverSignInCode(user, otp);
        },
      },
      backupCodeOptions: {
        amount: 10,
        storeBackupCodes: "encrypted",
      },
    }),
  ],
  secret: process.env.BETTER_AUTH_SECRET,
  hooks: {
    // ACC-1: password, email, backup-code and two-step changes by team members go through the My account page
    // (src/app/desk/account), which records them and emails the person. Direct web calls to these routes are refused
    // for the team; our own server code calls the library directly and is not affected. Customers cannot change
    // their sign-in email at all (their customer record is matched on it).
    before: createAuthMiddleware(async (ctx) => {
      if (!GUARDED_AUTH_PATHS.has(ctx.path)) return;
      const current = await getSessionFromCtx(ctx).catch(() => null);
      const decision = decideAccountAuthPath({
        path: ctx.path,
        viaHttp: Boolean(ctx.request),
        role: (current?.user as { role?: string } | undefined)?.role,
      });
      if (!decision.allow) throw APIError.fromStatus("FORBIDDEN", { message: decision.message });
    }),
  },
  // Vercel's production domain (appliance-desk.vercel.app) and every
  // preview deployment's own generated domain are all different
  // hostnames, and Better Auth rejects sign-in requests whose Origin
  // doesn't match baseURL ("Invalid origin"). A plain string baseURL
  // can only ever match one of those hosts. Better Auth's dynamic
  // baseURL config (allowedHosts) is built for exactly this — it
  // accepts the actual request's host as long as it matches one of
  // these patterns, so both production and every preview deployment
  // work without hand-setting a URL for each one. Once a real custom
  // domain is bought (see docs/ARCHITECTURE.md), add it here too.
  baseURL:
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    {
      allowedHosts: [
        "*.vercel.app",
        "robinsonappliancerentals.com",
        "www.robinsonappliancerentals.com",
      ],
      fallback: process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000",
    },
  emailAndPassword: {
    enabled: true,
    // Appliance Desk is invite/provision-only. Leaving Better Auth's
    // sign-up endpoint enabled allowed an anonymous person to pre-create a
    // CUSTOMER User for somebody else's email, after which a later business
    // workflow could accidentally attach the real Customer record to that
    // attacker-controlled credential. Trusted account creation now writes
    // Better Auth-compatible User + Account rows server-side through
    // src/lib/account-provisioning.ts instead of using the public endpoint.
    disableSignUp: true,
    // Flipped on 2026-09-28 (Task #70) now that email sending is
    // verified in production (see docs/ARCHITECTURE.md's "Real business
    // email" work, Task #69). Every account this app provisions (customer
    // or staff) sets emailVerified: true in the same trusted transaction
    // that creates the account. The activation/reset email still proves
    // inbox control before the recipient can choose a real password.
    requireEmailVerification: true,
    minPasswordLength: 10,
    // Password recovery is also an account-compromise boundary. Revoking
    // existing sessions prevents a stolen 14-day session cookie from
    // surviving after the legitimate user changes the credential.
    revokeSessionsOnPasswordReset: true,
    // Real "forgot password" flow (Phase 6A item 2 — customer account
    // invitation & password recovery). Better Auth generates and verifies
    // the one-time, expiring token itself (see the Verification table) —
    // this callback only has to deliver the link. Reused as the customer
    // *activation* mechanism too: brand-new provisioned accounts receive
    // this reset-password email so "set your first password" and "reset a
    // forgotten password" stay one code path.
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordEmail({
        to: user.email,
        ...await (await import("@/domains/language/auth-email")).credentialEmailCopy(user,url,"password"),
      });
    },
  },
  emailVerification: {
    // sendOnSignUp remains false because public sign-up itself is disabled.
    // This callback is retained for Better Auth's verification machinery and
    // any future explicitly-approved support flow.
    sendOnSignUp: false,
    autoSignInAfterVerification: true,
    afterEmailVerification: async (user) => {
      const { completeEmailChange } = await import("@/domains/account");
      await completeEmailChange({ id: user.id, email: user.email });
    },
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        ...await (await import("@/domains/language/auth-email")).credentialEmailCopy(user,url,"verify"),
      });
    },
  },
  rateLimit: {
    // Better Auth additionally applies a stricter sign-in-route limiter.
    // Four sequential CI-only accounts share one loopback IP, exhausting it
    // even with the global max raised. Disable limits ONLY when CI explicitly
    // uses the disposable localhost/appliance_desk_test database.
    enabled: !isDisposableCiAuthFixture(),
    window: 60,
    max: 10,
    // Shared across every running copy of the site (memory would give each copy its own counter).
    storage: "database",
    // ACC-3: asking for sign-in codes sends an email or text, so it is limited more tightly than the rest.
    customRules: { "/two-factor/send-otp": { window: 60, max: 3 } },
  },
  user: {
    // ACC-1: the person asks from My account; the link goes to the NEW address and nothing changes until it is used.
    changeEmail: { enabled: true },
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "CUSTOMER",
        input: false, // never settable by the client — only changed server-side
      },
      // Rides along on the session so requireSession() (src/lib/session.ts)
      // can reject a deactivated account without an extra database call
      // on every protected page. Set only by the "remove access" action
      // for a staff account (src/domains/staff) — never by the client.
      archivedAt: {
        type: "date",
        required: false,
        input: false,
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14, // 14 days
    updateAge: 60 * 60 * 24, // refresh once a day of activity
  },
});

export type Session = typeof auth.$Infer.Session;
