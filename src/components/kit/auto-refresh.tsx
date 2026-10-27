"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export const IDLE_LIMIT_MS = 10 * 60_000;
export const RETURN_AFTER_MS = 30_000;

export function refreshPermitted(input: {
  now: number;
  lastInteraction: number;
  visible: boolean;
  online: boolean;
  blocked: boolean;
}): boolean {
  return input.visible && input.online && !input.blocked &&
    input.now >= input.lastInteraction && input.now - input.lastInteraction < IDLE_LIMIT_MS;
}

export function freshnessLabel(ageMs: number): string {
  const minutes = Math.floor(Math.max(ageMs, 0) / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes === 1) return "Updated 1 min ago";
  return `Updated ${minutes} min ago`;
}

function pageHasUnfinishedWork(): boolean {
  return !!document.querySelector(
    'form[data-dirty="true"], dialog[open], [role="dialog"], [role="alertdialog"], [data-sheet="dialog"], [data-sheet="drawer"]',
  );
}

/** No background fetch: polling stops at ten idle minutes, in hidden tabs and while a form/dialog is open. */
export function AutoRefresh({ everySeconds = 60 }: { everySeconds?: number }) {
  const router = useRouter();
  const updatedRef = useRef(0);
  const lastInteraction = useRef(0);
  const hiddenAt = useRef<number | null>(null);
  const [ageMs, setAgeMs] = useState(0);

  useEffect(() => {
    // Initialize the first page-load time only after mount; never call Date.now() during render.
    const mounted = Date.now();
    updatedRef.current = mounted;
    lastInteraction.current = mounted;
    const activity = () => { lastInteraction.current = Date.now(); };
    const canRefresh = () => refreshPermitted({
      now: Date.now(),
      lastInteraction: lastInteraction.current,
      visible: document.visibilityState === "visible",
      online: navigator.onLine,
      blocked: pageHasUnfinishedWork(),
    });
    const update = () => {
      if (!canRefresh()) return;
      router.refresh();
      const now = Date.now();
      updatedRef.current = now;
      setAgeMs(0);
    };
    const visibility = () => {
      const now = Date.now();
      if (document.visibilityState !== "visible") {
        hiddenAt.current = now;
        return;
      }
      if (hiddenAt.current !== null && now - hiddenAt.current >= RETURN_AFTER_MS) update();
      hiddenAt.current = null;
    };
    window.addEventListener("pointerdown", activity, { passive: true });
    window.addEventListener("keydown", activity);
    window.addEventListener("scroll", activity, { passive: true, capture: true });
    document.addEventListener("visibilitychange", visibility);
    const timer = window.setInterval(() => {
      // Even if network or unsaved work blocks refreshing, tell the truth about data age.
      setAgeMs(Math.max(0, Date.now() - updatedRef.current));
      update();
    }, Math.max(15, everySeconds) * 1000);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
      window.removeEventListener("scroll", activity, true);
    };
  }, [everySeconds, router]);

  return <span aria-label="Page freshness" className="text-xs font-medium text-ink-soft">{freshnessLabel(ageMs)}</span>;
}
