"use client";

import { ErrorPanel } from "@/components/error-panel";

export default function AccountError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorPanel error={error} reset={reset} homeHref="/account" homeLabel="Go to my account" />;
}
