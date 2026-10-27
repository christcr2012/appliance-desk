"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "./sheet";

export const DESK_GO_ROUTES: Record<string, string> = {
  t: "/desk/today",
  c: "/desk/customers",
  s: "/desk/dispatch",
  e: "/desk/inventory",
  m: "/desk/revenue",
};

export function deskShortcutHref(key: string, role: string): string | null {
  if (key === "m" && role !== "OWNER" && role !== "ADMIN") return null;
  return DESK_GO_ROUTES[key] ?? null;
}

export function shortcutTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest("input, textarea, select, [contenteditable], [role='textbox'], [role='combobox']");
}

export function ignoreDeskShortcut(event: KeyboardEvent): boolean {
  return event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey ||
    event.altKey || shortcutTypingTarget(event.target);
}

const CHOICES = [
  ["/", "Focus search"],
  ["g then t", "Today"],
  ["g then c", "Customers"],
  ["g then s", "Schedule"],
  ["g then e", "Equipment"],
  ["g then m", "Money (owner and admin)"],
  ["j / k", "Next / previous table row"],
  ["Enter", "Open focused row"],
  ["Esc", "Close the side panel"],
  ["?", "Keyboard shortcuts"],
] as const;

/** Keyboard navigation is an opt-in enhancement to the ordinary accessible links; no access check is bypassed. */
export function DeskShortcuts({ role }: { role: string }) {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const goAt = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (window.matchMedia("(pointer: coarse)").matches) return;
      if (ignoreDeskShortcut(event)) {
        goAt.current = null;
        return;
      }
      // A modal owns its own keys, especially Escape. Never navigate behind a dialog.
      if (document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"]')) {
        goAt.current = null;
        return;
      }
      const key = event.key.toLowerCase();
      if (goAt.current !== null) {
        const inTime = Date.now() - goAt.current < 1500;
        goAt.current = null;
        const href = inTime ? deskShortcutHref(key, role) : null;
        if (href) {
          event.preventDefault();
          router.push(href);
          return;
        }
      }
      if (key === "g") {
        goAt.current = Date.now();
        return;
      }
      if (key === "/") {
        const search = [...document.querySelectorAll<HTMLInputElement>("[data-kit-search]")].find(
          (input) => input.getClientRects().length > 0 && !input.disabled,
        );
        if (search) {
          event.preventDefault();
          search.focus();
        }
        return;
      }
      if (key === "?") {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (key === "escape") {
        const close = document.querySelector<HTMLAnchorElement>('aside[data-kit-panel] a[aria-label="Close"]');
        if (close && close.getClientRects().length > 0) {
          event.preventDefault();
          close.click();
        }
        return;
      }
      if (key !== "j" && key !== "k") return;
      const rows = [...document.querySelectorAll<HTMLAnchorElement>('tr[data-row-key] a[href]')].filter(
        (a) => a.getClientRects().length > 0,
      );
      if (!rows.length) return;
      const index = rows.findIndex((row) => row === document.activeElement);
      const next = index < 0 ? (key === "j" ? 0 : rows.length - 1) :
        Math.max(0, Math.min(rows.length - 1, index + (key === "j" ? 1 : -1)));
      event.preventDefault();
      rows[next].focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router, role]);

  return (
    <Sheet open={helpOpen} onOpenChange={setHelpOpen} title="Keyboard shortcuts">
      <p className="mb-3 text-sm text-ink-soft">Use these when you are not typing in a field.</p>
      <dl className="space-y-2 text-sm">
        {CHOICES.filter(([key]) => key !== "g then m" || role !== "STAFF").map(([keys, line]) => (
          <div key={keys} className="flex items-center justify-between gap-4 border-b border-line py-2">
            <dt className="font-medium text-ink">{line}</dt>
            <dd><kbd className="rounded-field bg-tint px-2 py-1 font-bold text-ink">{keys}</kbd></dd>
          </div>
        ))}
      </dl>
    </Sheet>
  );
}
