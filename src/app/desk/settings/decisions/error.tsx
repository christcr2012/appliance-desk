"use client";

import { ErrorPanel } from "@/components/error-panel";

// KIT 5.3: Decisions & reviews keeps the rest of the desk working when this screen fails.
export default function DecisionsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorPanel error={error} reset={reset} homeHref="/desk/today" homeLabel="Go to Today" />
  );
}
