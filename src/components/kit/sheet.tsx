"use client";
// AR-0 kit 4.19: a small form on top of the page. Phones get a bottom sheet with a grab handle (vaul); desktop gets a
// centered 480 px dialog (Radix). The title is the accessible name; Escape and the backdrop close it and focus goes
// back to whatever opened it.
import * as Dialog from "@radix-ui/react-dialog";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Drawer } from "vaul";
import { Icon } from "./icons";
import { DESKTOP_QUERY, useMediaQuery } from "./use-media-query";

export type SheetProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
};

const CLOSE =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-field text-ink-soft hover:bg-tint lg:min-h-10 lg:min-w-10";

export function Sheet({ open, onOpenChange, title, children, footer }: SheetProps) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const change = useRef(onOpenChange);
  useLayoutEffect(() => {
    change.current = onOpenChange;
  });
  // A page kept alive in the background must not come back with a sheet still open (preserving-ui-state guide).
  useLayoutEffect(() => () => change.current(false), []);
  // Radix returns focus only to its own Trigger; the kit's sheets are opened by ordinary buttons, so remember the opener.
  const openedFrom = useRef<HTMLElement | null>(null);
  const focusProps = {
    onOpenAutoFocus: () => {
      const active = document.activeElement;
      openedFrom.current = active instanceof HTMLElement && active !== document.body ? active : null;
    },
    onCloseAutoFocus: (event: Event) => {
      if (!openedFrom.current) return;
      event.preventDefault();
      openedFrom.current.focus();
    },
  };

  if (desktop) {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40" />
          <Dialog.Content
            aria-describedby={undefined}
            {...focusProps}
            data-sheet="dialog"
            className="fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[480px] max-w-[calc(100vw-2.5rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card border border-line bg-surface text-ink shadow-raise"
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
              <Dialog.Title className="text-base font-bold">{title}</Dialog.Title>
              <Dialog.Close aria-label="Close" className={CLOSE}>
                <Icon name="close" />
              </Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer ? <div className="border-t border-line px-5 py-3">{footer}</div> : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-ink/40" />
        <Drawer.Content
          aria-describedby={undefined}
          {...focusProps}
          data-sheet="drawer"
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-card border-t border-line bg-surface text-ink shadow-raise"
        >
          <Drawer.Handle className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-line-strong" />
          <div className="flex items-center justify-between gap-3 px-5 pt-2 pb-1">
            <Drawer.Title className="text-base font-bold">{title}</Drawer.Title>
            <Drawer.Close aria-label="Close" className={CLOSE}>
              <Icon name="close" />
            </Drawer.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">{children}</div>
          {footer ? (
            <div className="border-t border-line px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>
          ) : null}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
