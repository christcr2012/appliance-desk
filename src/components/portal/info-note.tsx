"use client";

import { GlossaryPopover } from "@/components/kit/glossary-popover";
import { Icon } from "@/components/kit/icons";

/**
 * A free-text info note for portal pages (PORTAL-1): the kit's InfoTip
 * only speaks glossary terms, while the portal's help sentences are
 * page copy in the portal dictionary. Same kit popover underneath —
 * the sentence renders as its "what happens next" block.
 */
export function InfoNote({ label, text }: { label: string; text: string }) {
  return (
    <GlossaryPopover
      next={text}
      triggerLabel={label}
      triggerClassName="relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ink-soft before:absolute before:-inset-3 before:content-[''] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      trigger={<Icon name="info" className="h-4 w-4" />}
    />
  );
}
