"use client";
// Kit-internal: a glossary explanation on tap (what this means and what happens next). Radix Popover, so Escape and
// an outside tap close it and focus returns to the trigger.
import * as Popover from "@radix-ui/react-popover";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { GLOSSARY } from "@/lib/glossary";
import type { GlossaryKey } from "./types";

export function GlossaryPopover({
  term,
  next,
  trigger,
  triggerClassName,
  triggerLabel,
}: {
  term?: GlossaryKey;
  next?: string;
  trigger: ReactNode;
  triggerClassName: string;
  triggerLabel?: string;
}) {
  const entry = term ? GLOSSARY[term] : null;
  const [open, setOpen] = useState(false);
  // A hidden (kept-alive) page must not come back with the popover still open.
  useLayoutEffect(() => () => setOpen(false), []);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger type="button" className={triggerClassName} aria-label={triggerLabel}>
        {trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          role="note"
          sideOffset={6}
          collisionPadding={16}
          className="z-50 w-72 max-w-[85vw] rounded-card border border-line bg-surface p-3 text-left text-sm text-ink shadow-raise"
        >
          {entry ? <>
            <strong className="block font-bold">{entry.title}</strong>
            <span className="mt-1 block leading-relaxed">{entry.description}</span>
          </> : null}
          {next ? <div className={entry ? "mt-3 border-t border-line pt-3" : ""}>
            <strong className="block font-bold">What happens next</strong>
            <span className="mt-1 block leading-relaxed">{next}</span>
          </div> : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
