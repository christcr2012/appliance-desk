import * as Sentry from "@sentry/nextjs";

// Runs once when the server starts (both in Node and on the Edge runtime).
// See docs/HANDOFF.md for the SENTRY_DSN environment variable this needs.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
