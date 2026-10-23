import * as Sentry from "@sentry/nextjs";

/**
 * Tell Sentry about an error from background work (daily jobs, webhooks), where nobody is looking at a screen.
 * Safe to call anywhere: if Sentry is not set up or is slow, nothing changes for the caller.
 */
export async function reportBackgroundError(error: unknown, where: string): Promise<void> {
  try {
    Sentry.captureException(error, { tags: { background: where } });
    // A serverless function can be frozen right after it answers; give the report a moment to leave.
    await Promise.race([Sentry.flush(2000), new Promise((resolve) => setTimeout(resolve, 2500))]);
  } catch {
    // Reporting must never break the job it is reporting about.
  }
}
