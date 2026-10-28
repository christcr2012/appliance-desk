"use client";

import { RouteError } from "@/components/desk/route-error";

export default function PaymentsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} where="desk-payments" />;
}
