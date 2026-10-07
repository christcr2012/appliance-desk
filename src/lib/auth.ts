import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { twoFactor } from "better-auth/plugins";
import { prisma } from "./prisma";
import { sendEmail } from "./email";
import { sendPasswordEmail } from "./password-email";

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
      backupCodeOptions: {
        amount: 10,
        storeBackupCodes: "encrypted",
      },
    }),
  ],
  secret: process.env.BETTER_AUTH_SECRET,
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
        subject: "Set your Appliance Desk password",
        text: `Hi${user.name ? ` ${user.name}` : ""},\n\nUse the link below to set your password for Appliance Desk. This link expires in 1 hour and can only be used once.\n\n${url}\n\nIf you didn't request this, you can safely ignore this email — your password won't change.`,
        actionLabel: "Set my password",
      });
    },
  },
  emailVerification: {
    // sendOnSignUp remains false because public sign-up itself is disabled.
    // This callback is retained for Better Auth's verification machinery and
    // any future explicitly-approved support flow.
    sendOnSignUp: false,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Verify your Appliance Desk email address",
        text: `Hi${user.name ? ` ${user.name}` : ""},\n\nUse the link below to verify your email address for Appliance Desk. This link expires in 1 hour and can only be used once.\n\n${url}\n\nIf you didn't request this, you can safely ignore this email.`,
        actionLabel: "Verify my email",
      });
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 10,
  },
  user: {
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
