"use client";

import { useEffect } from "react";
import { toast } from "@/components/kit";

/**
 * PORTAL-1 section 5.4: when the pay route bounces back with
 * ?payError=1, the failure shows as a danger toast AND stays on the
 * page as an inline alert (the inline copy is what no-JS and
 * screen-reader users get; the toast is the kit pattern on top).
 */
export function PayErrorToast({ message }: { message: string }) {
  useEffect(() => {
    toast({ message, tone: "danger" });
  }, [message]);
  return (
    <p role="alert" className="mt-4 text-sm font-semibold text-danger print:hidden">
      {message}
    </p>
  );
}
