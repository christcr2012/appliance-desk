"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";

const ACTIVITY_EVENTS = [
  "mousedown",
  "mousemove",
  "keydown",
  "touchstart",
  "scroll",
  "wheel",
] as const;

// Shared across tabs via localStorage, so moving to a different tab in
// the same browser doesn't sign the person out from under them while
// they're still using the app in another tab.
const STORAGE_KEY = "appliance-desk:last-activity";
// Don't write to localStorage on every single mousemove — that's a lot
// of writes for no benefit. Once every few seconds is plenty to track
// "is anyone still here."
const ACTIVITY_WRITE_THROTTLE_MS = 5_000;
const WARNING_MS = 60_000; // show the "still there?" banner this long before signing out

/**
 * Signs the person out after a period of no activity anywhere in the
 * browser (not just this tab) — a real security feature Chris asked for
 * (2026-09-27), since the owner desk and customer portal show customer
 * and billing information and previously stayed signed in indefinitely
 * (14-day session, no idle check at all) if left open on a shared or
 * unattended computer.
 *
 * Shows a warning banner with a countdown for the last minute before
 * signing out, so a person who's still there but just hasn't touched
 * anything (reading a long page, on a phone call) gets a chance to stay
 * signed in rather than being logged out with no notice.
 */
export function IdleLogout({ timeoutMinutes }: { timeoutMinutes: number }) {
  const timeoutMs = timeoutMinutes * 60_000;
  const router = useRouter();
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const lastWriteRef = useRef(0);
  const signingOutRef = useRef(false);

  function recordActivity() {
    const now = Date.now();
    if (now - lastWriteRef.current < ACTIVITY_WRITE_THROTTLE_MS) return;
    lastWriteRef.current = now;
    try {
      localStorage.setItem(STORAGE_KEY, String(now));
    } catch {
      // Private browsing / storage disabled — idle logout still works
      // for this one tab via the in-memory ref below, just not synced
      // across tabs. Not worth failing the page over.
    }
  }

  useEffect(() => {
    // Seed activity now so a freshly opened tab doesn't start the clock
    // from whatever a stale localStorage value says.
    let lastActivity = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY, String(lastActivity));
    } catch {
      // ignore — see recordActivity's comment
    }

    function onActivity() {
      lastActivity = Date.now();
      recordActivity();
    }

    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      const value = Number(e.newValue);
      if (Number.isFinite(value)) lastActivity = value;
    }

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { passive: true });
    }
    window.addEventListener("storage", onStorage);

    const interval = window.setInterval(() => {
      // Another tab may have a newer timestamp than this tab's own
      // closure variable — re-check localStorage each tick too.
      try {
        const stored = Number(localStorage.getItem(STORAGE_KEY));
        if (Number.isFinite(stored) && stored > lastActivity) {
          lastActivity = stored;
        }
      } catch {
        // ignore — see recordActivity's comment
      }

      const remaining = timeoutMs - (Date.now() - lastActivity);

      if (remaining <= 0) {
        if (signingOutRef.current) return;
        signingOutRef.current = true;
        void signOut().finally(() => {
          router.push("/login?reason=timeout");
          router.refresh();
        });
        return;
      }

      setSecondsLeft(remaining <= WARNING_MS ? Math.ceil(remaining / 1000) : null);
    }, 1000);

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onActivity);
      }
      window.removeEventListener("storage", onStorage);
      window.clearInterval(interval);
    };
  }, [timeoutMs, router]);

  if (secondsLeft === null) return null;

  return (
    <div
      role="alertdialog"
      aria-labelledby="idle-logout-heading"
      aria-describedby="idle-logout-body"
      className="fixed inset-x-0 bottom-0 z-[100] border-t border-line bg-white px-4 py-4 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]"
    >
      <div className="mx-auto flex max-w-3xl flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p id="idle-logout-heading" className="font-medium text-ink">
            You&apos;ll be signed out soon
          </p>
          <p id="idle-logout-body" className="text-sm text-ink-soft">
            No activity for a while — signing out in {secondsLeft} second
            {secondsLeft === 1 ? "" : "s"} to keep your account safe.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            lastWriteRef.current = 0; // force the next recordActivity() through
            recordActivity();
            setSecondsLeft(null);
          }}
          className="shrink-0 rounded-md bg-action px-4 py-2 text-sm font-semibold text-on-action hover:bg-action"
        >
          Stay signed in
        </button>
      </div>
    </div>
  );
}
