"use client";
// AR-0b (KIT 5.3): the error screen for a redesigned desk page — one line, "Try again" and "Go to Today". The error is
// reported through the existing src/lib/report-error.ts.
import Link from "next/link";
import { useEffect } from "react";
import { reportBackgroundError } from "@/lib/report-error";

export function RouteError({ error, reset, where }: { error: Error & { digest?: string }; reset: () => void; where: string }) {
  useEffect(() => {
    void reportBackgroundError(error, where);
  }, [error, where]);
  return (
    <section role="alert" className="flex flex-col items-start gap-4 rounded-card bg-surface px-4 py-6">
      <h1 tabIndex={-1} className="text-xl font-extrabold text-ink">
        Something went wrong loading this page.
      </h1>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-11 items-center rounded-field bg-primary px-4 text-[15px] font-bold text-on-primary hover:bg-primary-dark lg:min-h-10"
        >
          Try again
        </button>
        <Link
          href="/desk/today"
          className="inline-flex min-h-11 items-center rounded-field border border-line-strong bg-surface px-4 text-[15px] font-bold text-ink hover:bg-tint lg:min-h-10"
        >
          Go to Today
        </Link>
      </div>
    </section>
  );
}
