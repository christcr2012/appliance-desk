"use client";
// AR-11: a touch-only shortcut to the same guarded row actions that remain available in the ⋯ menu.
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ActionButton } from "./action-button";
import type { MenuItem } from "./types";

export const SWIPE_REVEAL_PX = 64;

export function swipeIntent(dx: number, dy: number, alreadyOpen: boolean): "open" | "close" | "none" {
  if (Math.abs(dx) < SWIPE_REVEAL_PX || Math.abs(dx) <= Math.abs(dy) * 1.2) return "none";
  if (dx < 0) return "open";
  return alreadyOpen ? "close" : "none";
}

type Start = { id: number; x: number; y: number };
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

/** The full record link and ⋯ menu are never replaced or shortcut around any form confirmation. */
export function MobileSwipeCard({
  actions,
  children,
  label,
}: {
  actions: MenuItem[];
  children: ReactNode;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const start = useRef<Start | null>(null);
  const suppressNextClick = useRef(false);
  const root = useRef<HTMLLIElement>(null);
  const swipable = actions.length > 0;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const closeForReducedMotion = () => { if (media?.matches) setOpen(false); };
    media?.addEventListener("change", closeForReducedMotion);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      media?.removeEventListener("change", closeForReducedMotion);
    };
  }, [open]);

  const pointerDown = (event: ReactPointerEvent<HTMLLIElement>) => {
    if (!root.current?.contains(event.target as Node)) return;
    suppressNextClick.current = false;
    if (!swipable || event.pointerType !== "touch" || prefersReducedMotion()) return;
    if ((event.target as Element).closest("[data-swipe-actions]")) return;
    start.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const pointerUp = (event: ReactPointerEvent<HTMLLIElement>) => {
    const gesture = start.current;
    start.current = null;
    if (!gesture || event.pointerId !== gesture.id) return;
    const next = swipeIntent(event.clientX - gesture.x, event.clientY - gesture.y, open);
    if (next === "none") return;
    setOpen(next === "open");
    // Touch browsers may synthesize a click after pointerup: it must not open the record.
    suppressNextClick.current = true;
  };
  const clickCapture = (event: MouseEvent<HTMLLIElement>) => {
    // Radix dialogs are portals: events bubble through React but not through this DOM row.
    if (!root.current?.contains(event.target as Node)) return;
    if (suppressNextClick.current) {
      suppressNextClick.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (open && !(event.target as Element).closest("[data-swipe-actions]")) {
      // The first tap on the moved card simply closes the reveal.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <li
      ref={root}
      data-swipe-card={swipable ? label : undefined}
      data-swipe-open={open ? "true" : "false"}
      className="relative overflow-hidden rounded-card bg-surface"
      onPointerDown={pointerDown}
      onPointerUp={pointerUp}
      onPointerCancel={() => { start.current = null; }}
      onClickCapture={clickCapture}
    >
      {open && swipable ? (
        <div data-swipe-actions aria-label={`Actions for ${label}`} className="absolute inset-y-0 right-0 flex w-[min(65vw,280px)] items-center gap-1.5 bg-tint px-2">
          {actions.slice(0, 2).map((action, index) => (
            <ActionButton
              key={`${action.kind}-${action.label}-${index}`}
              spec={action}
              variant="secondary"
              className="min-w-0 flex-1 text-center text-xs"
            />
          ))}
        </div>
      ) : null}
      <div
        data-swipe-face
        style={{ transform: open ? "translateX(calc(-1 * min(65vw, 280px)))" : undefined }}
        className="relative z-10 flex items-start gap-3 bg-surface px-4 py-3.5 [touch-action:pan-y] transition-transform duration-[180ms] ease-out motion-reduce:transition-none"
      >
        {children}
      </div>
    </li>
  );
}
