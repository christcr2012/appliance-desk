"use client";
// Escape closes the side panel, but only while focus is inside it (the listener is scoped to the panel).
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

export function SidePanelEscape({ closeHref, children }: { closeHref: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        router.push(closeHref, { scroll: false });
      }}
    >
      {children}
    </div>
  );
}
