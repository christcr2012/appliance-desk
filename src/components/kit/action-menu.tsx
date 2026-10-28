"use client";
// Kit ⋯ menu for items the ActionSpec kinds cannot express: opening a sheet in place, printing, or a
// link that opens in a new tab. Same look as OverflowMenu; use OverflowMenu whenever an item is a
// plain link or a server form action.
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { useLayoutEffect, useState } from "react";
import { Icon } from "./icons";

const ITEM =
  "flex min-h-11 w-full cursor-pointer select-none items-center rounded-field px-3 text-[15px] font-semibold outline-none data-[highlighted]:bg-tint lg:min-h-10";

export type ActionMenuItem =
  | { label: string; href: string; external?: boolean; danger?: boolean }
  | { label: string; onSelect: () => void; danger?: boolean };

export function ActionMenu({ items, label }: { items: ActionMenuItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => () => setOpen(false), []);
  if (items.length === 0) return null;
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger
        aria-label={label}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-field border border-line-strong bg-surface text-ink hover:bg-tint lg:min-h-10 lg:min-w-10"
      >
        <Icon name="more" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          collisionPadding={16}
          className="z-50 min-w-[220px] rounded-card border border-line bg-surface p-1.5 text-ink shadow-raise"
        >
          {items.map((item) => {
            const tone = item.danger ? "text-danger" : "text-ink";
            if ("onSelect" in item) {
              return (
                <DropdownMenu.Item key={item.label} className={`${ITEM} ${tone}`} onSelect={item.onSelect}>
                  {item.label}
                </DropdownMenu.Item>
              );
            }
            return (
              <DropdownMenu.Item key={item.label} asChild className={`${ITEM} ${tone}`}>
                {item.external ? (
                  <a href={item.href} target="_blank" rel="noreferrer">
                    {item.label}
                  </a>
                ) : (
                  <Link href={item.href}>{item.label}</Link>
                )}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
