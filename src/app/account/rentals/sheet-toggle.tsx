"use client";

import { useState, type ReactNode } from "react";
import { Sheet } from "@/components/kit";

/**
 * PORTAL-1 section 5.2: a button that opens its children in a kit
 * Sheet. The children are server-rendered (the existing ending and
 * renewal forms with their server actions untouched); this wrapper
 * only owns the open state. The kit Sheet returns focus to the button
 * when it closes.
 */
export function SheetToggle({
  buttonLabel,
  title,
  children,
}: {
  buttonLabel: string;
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-tint"
      >
        {buttonLabel}
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={title}>
        {children}
      </Sheet>
    </>
  );
}
