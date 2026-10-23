"use client";

import { ErrorPanel } from "@/components/error-panel";

export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorPanel error={error} reset={reset} homeHref="/" homeLabel="Go to the home page" />;
}
