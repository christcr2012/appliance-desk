"use client";

import { ErrorPanel } from "@/components/error-panel";

export default function DeskError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorPanel error={error} reset={reset} homeHref="/desk/today" homeLabel="Go to Today" />;
}
