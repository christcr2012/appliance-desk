import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma";

// Central auth configuration. Roles are OWNER / ADMIN / CUSTOMER — see
// docs/BUSINESS-RULES.md for what each role can do. Every owner/admin
// route and every customer-ownership check is enforced on the SERVER
// (in this file, in middleware.ts, and in each server action) — never
// only by hiding a button in the UI.
export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  // Vercel sets VERCEL_URL automatically on every deployment (production
  // and preview alike) — falling back to it means this works correctly
  // without hand-setting BETTER_AUTH_URL for every preview URL.
  baseURL:
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // flip on once email sending is verified in production
    minPasswordLength: 10,
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
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14, // 14 days
    updateAge: 60 * 60 * 24, // refresh once a day of activity
  },
});

export type Session = typeof auth.$Infer.Session;
