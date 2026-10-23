"use client";

import Link from "next/link";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * Friendly "something went wrong" screen shared by every error boundary.
 * Reports the crash to Sentry and gives a plain way to try again.
 */
export function ErrorPanel({
  error,
  reset,
  homeHref,
  homeLabel,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  homeHref: string;
  homeLabel: string;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="mx-auto max-w-xl px-6 py-16 text-ink">
      <div className="rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <h1 className="text-2xl font-semibold">Something went wrong on our end</h1>
        <p className="mt-3 text-base leading-7 text-ink-soft">
          Nothing you did caused this, and nothing was lost. Please try again. If it keeps
          happening, wait a minute and reload the page.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 items-center rounded-lg bg-action px-5 font-medium text-on-action"
          >
            Try again
          </button>
          <Link
            href={homeHref}
            className="inline-flex min-h-11 items-center rounded-lg border border-line px-5 font-medium"
          >
            {homeLabel}
          </Link>
        </div>
        {error.digest ? (
          <p className="mt-6 text-sm text-ink-faint">Reference: {error.digest}</p>
        ) : null}
      </div>
    </main>
  );
}
