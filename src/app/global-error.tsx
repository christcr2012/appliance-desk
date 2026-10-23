"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

// Last-resort screen if the page frame itself fails. It must bring its own
// <html>/<body>, so it uses plain inline styles.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "4rem 1.5rem" }}>
        <main style={{ maxWidth: "32rem", margin: "0 auto" }}>
          <h1 style={{ fontSize: "1.5rem" }}>Something went wrong on our end</h1>
          <p style={{ lineHeight: 1.6 }}>
            Nothing was lost. Please try again. If it keeps happening, wait a minute and reload.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{ minHeight: "2.75rem", padding: "0 1.25rem", fontSize: "1rem" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
