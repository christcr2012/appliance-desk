import * as Sentry from "@sentry/nextjs";

// Runs once in the browser. Catches errors and performance issues that
// happen on the customer's device (a broken form, a slow page) — the
// ones server-side monitoring alone would miss.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
});
