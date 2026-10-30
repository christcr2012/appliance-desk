"use client";

import { useState, type ReactNode } from "react";
import { Sheet } from "@/components/kit";

/**
 * PORTAL-1 section 5.3: the repair and pickup forms live in kit Sheets.
 * A button opens the sheet; when the page is reached with
 * ?request=repair or ?request=pickup (the links from Home and the
 * shell), autoOpen starts it open. The form itself is server-rendered
 * and unchanged — this wrapper only owns the open state.
 */
export function RequestSheet({
  buttonLabel,
  title,
  intro,
  autoOpen = false,
  primary = false,
  children,
}: {
  buttonLabel: string;
  title: string;
  intro?: string;
  autoOpen?: boolean;
  primary?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(autoOpen);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          primary
            ? "inline-flex min-h-11 items-center rounded-control bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-dark"
            : "inline-flex min-h-11 items-center rounded-control border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-tint"
        }
      >
        {buttonLabel}
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={title}>
        {intro ? <p className="mb-4 text-sm text-ink-soft">{intro}</p> : null}
        {children}
      </Sheet>
    </>
  );
}
