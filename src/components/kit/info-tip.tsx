// AR-0b: the kit's small "i" button beside a label that opens its glossary entry (KIT 4.21 "info"). Same popover as
// StatusPill and StatStrip use, so help reads the same everywhere; the 44 px tap area comes from an invisible ::before.
import { GlossaryPopover } from "./glossary-popover";
import { Icon } from "./icons";
import { GLOSSARY } from "@/lib/glossary";
import type { GlossaryKey } from "./types";

export function InfoTip({ term }: { term: GlossaryKey }) {
  return (
    <GlossaryPopover
      term={term}
      triggerLabel={`What does ${GLOSSARY[term].title} mean?`}
      triggerClassName="relative inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-soft before:absolute before:-inset-3 before:content-[''] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      trigger={<Icon name="info" className="h-4 w-4" />}
    />
  );
}
