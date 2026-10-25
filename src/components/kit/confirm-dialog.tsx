"use client";
// AR-0 kit 4.12: the plain confirmation for money and actions that cannot be undone. Focus starts on Cancel.
import * as Dialog from "@radix-ui/react-dialog";
import { useRef, type RefObject } from "react";
import type { ConfirmSpec } from "./types";

export function ConfirmDialog({
  open,
  onOpenChange,
  spec,
  onConfirm,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spec: ConfirmSpec;
  onConfirm: () => void;
  /** Where focus goes when it closes (KIT 6.7). Safari does not focus a button on click, so pass the trigger. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const openedFrom = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40" />
        <Dialog.Content
          role="alertdialog"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const active = document.activeElement;
            openedFrom.current = active instanceof HTMLElement && active !== document.body ? active : null;
            cancelRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            (returnFocusRef?.current ?? openedFrom.current)?.focus();
          }}
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2.5rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-surface p-5 text-ink shadow-raise"
        >
          <Dialog.Title className="text-lg font-extrabold">{spec.title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-[15px] text-ink-soft">{spec.summary}</Dialog.Description>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close asChild>
              <button
                ref={cancelRef}
                type="button"
                className="min-h-11 rounded-field border border-line-strong bg-surface px-4 text-[15px] font-bold text-ink lg:h-10 lg:min-h-0"
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              data-danger={spec.danger ? "true" : undefined}
              onClick={() => {
                onOpenChange(false);
                onConfirm();
              }}
              className={`min-h-11 rounded-field px-4 text-[15px] font-bold lg:h-10 lg:min-h-0 ${
                spec.danger ? "bg-danger text-on-primary" : "bg-primary text-on-primary"
              }`}
            >
              {spec.confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
