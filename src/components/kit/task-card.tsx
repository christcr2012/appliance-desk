"use client";
// AR-7 (BOOKS-TAXES 1.1, design BOOKS-AUTOPILOT 8): one large tap target per job — title, a status
// pill, and the purpose behind the info button. Replaces rows of bare underlined links on hub pages.
// The info text is free text (the design quotes it per card), so the popover body is rendered here
// with the same kit popover styling GlossaryPopover uses.
import * as Popover from "@radix-ui/react-popover";
import Link from "next/link";
import { useLayoutEffect, useState } from "react";
import { Icon } from "./icons";
import { StatusPill } from "./status-pill";
import type { Tone } from "./types";

export type TaskCardSpec = {
  title: string;
  status: { label: string; tone: Tone };
  info: string;
  href: string;
};

export function TaskCard({ title, status, info, href }: TaskCardSpec) {
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => () => setOpen(false), []);
  return (
    <div className="relative rounded-card border border-line bg-surface px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={href}
          className="min-w-0 flex-1 text-base font-bold text-ink after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {title}
        </Link>
        <StatusPill label={status.label} tone={status.tone} />
      </div>
      <div className="mt-1.5 flex items-center gap-1 text-sm text-ink-soft">
        <span className="min-w-0">What this is for</span>
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger
            type="button"
            aria-label={`What is ${title} for?`}
            className="relative inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-soft before:absolute before:-inset-3 before:content-[''] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <Icon name="info" className="h-4 w-4" />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              role="note"
              sideOffset={6}
              collisionPadding={16}
              className="z-50 w-72 max-w-[85vw] rounded-card border border-line bg-surface p-3 text-left text-sm text-ink shadow-raise"
            >
              <strong className="block font-bold">{title}</strong>
              <span className="mt-1 block leading-relaxed">{info}</span>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}
