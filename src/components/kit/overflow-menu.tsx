"use client";
// Kit-internal ⋯ menu (Radix DropdownMenu) for MenuItem[]: links navigate, form items run their action (after the
// plain ConfirmDialog when they have one) and report the result with a toast.
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { ConfirmDialog } from "./confirm-dialog";
import { Icon } from "./icons";
import { fieldsToFormData, runFormAction } from "./run-action";
import { assertActionSpec, type ActionSpec, type MenuItem } from "./types";

const ITEM =
  "flex min-h-11 w-full cursor-pointer select-none items-center rounded-field px-3 text-[15px] font-semibold outline-none data-[highlighted]:bg-tint lg:min-h-10";

export function OverflowMenu({
  items,
  label = "More actions",
  triggerClassName,
}: {
  items: MenuItem[];
  label?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<Extract<ActionSpec, { kind: "form" }> | null>(null);
  const [pending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => () => setOpen(false), []);
  if (items.length === 0) return null;
  items.forEach(assertActionSpec);

  const run = (spec: Extract<ActionSpec, { kind: "form" }>) =>
    startTransition(async () => {
      await runFormAction(spec, fieldsToFormData(spec.fields));
    });

  return (
    <>
      <DropdownMenu.Root open={open} onOpenChange={setOpen}>
        <DropdownMenu.Trigger
          ref={triggerRef}
          aria-label={label}
          aria-busy={pending || undefined}
          className={
            triggerClassName ??
            "inline-flex min-h-11 min-w-11 items-center justify-center rounded-field border border-line-strong bg-surface text-ink hover:bg-tint lg:min-h-10 lg:min-w-10"
          }
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
              const key = `${item.kind}-${item.label}`;
              if (item.kind === "form") {
                return (
                  <DropdownMenu.Item
                    key={key}
                    className={`${ITEM} ${tone}`}
                    disabled={pending}
                    onSelect={() => (item.confirm ? setConfirming(item) : run(item))}
                  >
                    {item.label}
                  </DropdownMenu.Item>
                );
              }
              const href =
                item.kind === "link" ? item.href : item.kind === "tel" ? `tel:${item.phone.replace(/[^\d+]/g, "")}` : `mailto:${item.email}`;
              return (
                <DropdownMenu.Item key={key} asChild className={`${ITEM} ${tone}`}>
                  {item.kind === "link" ? <Link href={href}>{item.label}</Link> : <a href={href}>{item.label}</a>}
                </DropdownMenu.Item>
              );
            })}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {confirming?.confirm ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setConfirming(null);
          }}
          spec={confirming.confirm}
          onConfirm={() => run(confirming)}
          returnFocusRef={triggerRef}
        />
      ) : null}
    </>
  );
}
