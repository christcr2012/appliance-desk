import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma";
import { sendEmail } from "./email";

// Central auth configuration. Roles are OWNER / ADMIN / CUSTOMER — see
// docs/BUSINESS-RULES.md for what each role can do. Every owner/admin
// route and every customer-ownership check is enforced on the SERVER
// (in this file, in src/proxy.ts, and in each server action) — never
// only by hiding a button in the UI.
export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
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
    // Flipped on 2026-09-28 (Task #70) now that email sending is
    // verified in production (see docs/ARCHITECTURE.md's "Real business
    // email" work, Task #69). Every account this app creates (customer
    // or staff) sets emailVerified: true itself the moment it's created
    // — see the comments in src/domains/leads/index.ts,
    // src/domains/customers/index.ts, and src/domains/staff/index.ts —
    // because the "set your password" activation email those flows
    // already send is itself proof the person controls that inbox
    // (there's no self-serve signup in this app for a second, separate
    // verification step to actually protect against). This flag mainly
    // exists so that invariant is enforced by Better Auth itself, not
    // just by convention, and so a future signup path that forgets to
    // set emailVerified doesn't silently skip verification.
    requireEmailVerification: true,
    minPasswordLength: 10,
    // Real "forgot password" flow (Phase 6A item 2 — customer account
    // invitation & password recovery). Better Auth generates and verifies
    // the one-time, expiring token itself (see the Verification table) —
    // this callback only has to deliver the link. Reused as the customer
    // *activation* mechanism too (see convertLeadToCustomer in
    // src/domains/leads/index.ts): rather than inventing a separate
    // invite-token system, a brand-new customer account is activated by
    // triggering this same reset-password email right after signup, so
    // "set your first password" and "reset a forgotten password" are one
    // code path, not two to keep in sync.
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Set your Appliance Desk password",
        text: `Hi${user.name ? ` ${user.name}` : ""},\n\nUse the link below to set your password for Appliance Desk. This link expires in 1 hour and can only be used once.\n\n${url}\n\nIf you didn't request this, you can safely ignore this email — your password won't change.`,
        actionLabel: "Set my password",
      });
    },
  },
  emailVerification: {
    // sendOnSignUp is deliberately false: every account this app creates
    // sets emailVerified: true itself right after signUpEmail (see the
    // requireEmailVerification comment above), so a customer or staff
    // member should never actually see this email in normal use — it
    // would only double up on the "set your password" activation email
    // they already get. This callback exists as a safety net (Better
    // Auth needs it configured for a clean "please verify" error instead
    // of a generic one) and for "resend verification email" if Chris
    // ever needs it from a support situation.
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
