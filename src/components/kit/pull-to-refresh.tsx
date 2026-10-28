"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type PointerEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export const PULL_REFRESH_THRESHOLD = 72;
const MAX_HORIZONTAL_DRIFT = 48;

export function pullDistance(startY: number, currentY: number, horizontalDrift: number): number {
  if (Math.abs(horizontalDrift) > MAX_HORIZONTAL_DRIFT) return 0;
  return Math.max(0, currentY - startY);
}

export function canPullRefresh(input: {
  touch: boolean;
  coarse: boolean;
  atTop: boolean;
  reducedMotion: boolean;
  online: boolean;
  blocked: boolean;
}): boolean {
  return input.touch && input.coarse && input.atTop && !input.reducedMotion &&
    input.online && !input.blocked;
}

function hasUnsavedWork(): boolean {
  return !!document.querySelector('form[data-dirty="true"], dialog[open], [role="dialog"], [role="alertdialog"], [data-sheet="dialog"], [data-sheet="drawer"]');
}

function readyToRefresh(): boolean {
  return navigator.onLine && document.body.dataset.offline !== "true" &&
    document.visibilityState === "visible" && !hasUnsavedWork();
}

type Pull = { id: number; startX: number; startY: number; distance: number };

/** Additional phone-only refresh gesture. No mutation or server action is ever called. */
export function PullToRefresh({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [distance, setDistance] = useState(0);
  const [updated, setUpdated] = useState(false);
  const [pending, startTransition] = useTransition();
  const gesture = useRef<Pull | null>(null);
  const touchGesture = useRef<Pull | null>(null);
  const surface = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(() => {
    if (!readyToRefresh() || pending) return;
    setUpdated(false);
    startTransition(() => {
      router.refresh();
      setUpdated(true);
    });
  }, [pending, router]);

  // Native, non-passive touchmove prevents the browser from taking over an eligible
  // downward pull. Upward/sideways scroll stays native; pointercancel does not
  // cancel the independent touch gesture. React synthetic touch handlers are passive.
  useEffect(() => {
    const root = surface.current;
    if (!root) return;
    const start = (event: TouchEvent) => {
      touchGesture.current = null;
      if (event.touches.length !== 1 || (event.target instanceof Element &&
        event.target.closest("button, a, input, select, textarea, [contenteditable]"))) return;
      const atTop = (document.scrollingElement?.scrollTop ?? window.scrollY) <= 0;
      if (!canPullRefresh({ touch: true, coarse: window.matchMedia("(pointer: coarse)").matches,
        atTop, reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        online: readyToRefresh(), blocked: pending })) return;
      const t = event.touches[0];
      gesture.current = null;
      touchGesture.current = { id: t.identifier, startX: t.clientX, startY: t.clientY, distance: 0 };
    };
    const move = (event: TouchEvent) => {
      const current = touchGesture.current;
      if (!current) return;
      const touch = Array.from(event.touches).find((t) => t.identifier === current.id);
      if (!touch) return;
      const next = pullDistance(current.startY, touch.clientY, touch.clientX - current.startX);
      current.distance = next;
      if (next > 0) event.preventDefault();
      setDistance(next);
    };
    const end = (event: TouchEvent) => {
      const current = touchGesture.current;
      if (!current || !Array.from(event.changedTouches).some((t) => t.identifier === current.id)) return;
      touchGesture.current = null;
      setDistance(0);
      if (current.distance >= PULL_REFRESH_THRESHOLD &&
        (document.scrollingElement?.scrollTop ?? window.scrollY) <= 0) refresh();
    };
    const cancelTouch = () => { touchGesture.current = null; setDistance(0); };
    root.addEventListener("touchstart", start, { passive: true });
    root.addEventListener("touchmove", move, { passive: false });
    root.addEventListener("touchend", end);
    root.addEventListener("touchcancel", cancelTouch);
    // The touch listener must be attached before the user (or a browser test) begins a gesture.
    root.dataset.pullReady = "true";
    return () => {
      delete root.dataset.pullReady;
      root.removeEventListener("touchstart", start);
      root.removeEventListener("touchmove", move);
      root.removeEventListener("touchend", end);
      root.removeEventListener("touchcancel", cancelTouch);
    };
  }, [pending, refresh]);

  function down(event: PointerEvent<HTMLDivElement>) {
    gesture.current = null;
    if (event.pointerType !== "touch" || (event.target instanceof Element &&
      event.target.closest("button, a, input, select, textarea, [contenteditable]"))) return;
    const atTop = (document.scrollingElement?.scrollTop ?? window.scrollY) <= 0;
    if (!canPullRefresh({
      touch: true,
      coarse: window.matchMedia("(pointer: coarse)").matches,
      atTop,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      online: readyToRefresh(),
      blocked: pending,
    })) return;
    gesture.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, distance: 0 };
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || event.pointerId !== current.id) return;
    const next = pullDistance(current.startY, event.clientY, event.clientX - current.startX);
    current.distance = next;
    setDistance(next);
  }

  function end(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || event.pointerId !== current.id) return;
    gesture.current = null;
    setDistance(0);
    if (current.distance >= PULL_REFRESH_THRESHOLD &&
      (document.scrollingElement?.scrollTop ?? window.scrollY) <= 0) refresh();
  }

  function cancel() {
    gesture.current = null;
    setDistance(0);
  }

  return (
    <div ref={surface} data-pull-to-refresh onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={cancel}>
      <div data-testid="pull-refresh-status" aria-live="polite" role="status" className="min-h-4 touch-none text-center text-xs text-ink-soft lg:hidden">
        {pending ? "Refreshing…" : distance >= PULL_REFRESH_THRESHOLD ? "Release to refresh" :
          distance > 0 ? "Pull down to refresh" : updated ? "Updated just now" : ""}
      </div>
      <div className="mb-2 hidden justify-end motion-reduce:flex lg:motion-reduce:hidden">
        <button type="button" onClick={refresh}
          className="inline-flex min-h-11 items-center rounded-field border border-line-strong bg-surface px-4 text-sm font-bold text-ink">
          Refresh
        </button>
      </div>
      {children}
    </div>
  );
}
