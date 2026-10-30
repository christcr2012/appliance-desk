"use client";

import Link from "next/link";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { useKitWords } from "@/components/kit/words";
import { useCustomerTranslation } from "@/domains/language/client-portal";

/**
 * PORTAL-1 section 6: the portal error state speaks the kit words
 * (pageLoadFailed + tryAgain) in the customer's language, via the
 * shell's KitWordsProvider. The digest stays visible for support.
 */
export default function AccountError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const words = useKitWords();
  const tr = useCustomerTranslation();
  // Same reporting the shared ErrorPanel did before this page grew
  // its own kit-worded error state.
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <div className="max-w-2xl rounded-card border border-line bg-surface px-4 py-6">
      <p role="alert" className="text-base font-bold text-ink">
        {words.pageLoadFailed}
      </p>
      {error.digest && (
        <p className="mt-1 text-xs text-ink-faint">Ref: {error.digest}</p>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-11 items-center rounded-control bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-dark"
        >
          {words.tryAgain}
        </button>
        <Link
          href="/account"
          className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-tint"
        >
          {tr("Go to my account")}
        </Link>
      </div>
    </div>
  );
}
