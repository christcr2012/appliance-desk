"use client";

import { useSyncExternalStore } from "react";
import {
  getStoredPreference,
  resolveTheme,
  setThemePreference,
  THEME_CHANGE_EVENT,
  type ResolvedTheme,
} from "@/lib/theme";

// useSyncExternalStore (not useState+useEffect) because the value this
// reads — localStorage plus the device's own light/dark setting — is
// genuinely external to React, and only exists in the browser. It lets
// the very first render safely return null on both the server and the
// client (matching, so no hydration warning), then swap in the real
// answer right after, without the "calling setState during an effect"
// pattern React's linter (rightly) doesn't like for anything simpler.
function subscribe(callback: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", callback);
  window.addEventListener("storage", callback);
  window.addEventListener(THEME_CHANGE_EVENT, callback);
  return () => {
    media.removeEventListener("change", callback);
    window.removeEventListener("storage", callback);
    window.removeEventListener(THEME_CHANGE_EVENT, callback);
  };
}

function getSnapshot(): ResolvedTheme {
  return resolveTheme(getStoredPreference());
}

function getServerSnapshot(): null {
  return null;
}

/**
 * Light/dark toggle (Chris asked for dark mode support, 2026-09-27).
 * Kept as a simple two-way switch rather than a light/dark/system cycle
 * — easier to understand at a glance, and it still starts from the
 * device's own setting (src/lib/theme.ts's "system" default) the first
 * time someone visits.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const resolved = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (resolved === null) {
    // Reserve the same space so the header doesn't jump once this
    // resolves a moment later.
    return (
      <span aria-hidden="true" className={`inline-block h-9 w-9 ${className}`} />
    );
  }

  function toggle() {
    const next: ResolvedTheme = resolved === "dark" ? "light" : "dark";
    setThemePreference(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={resolved === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-md text-current hover:bg-black/5 dark:hover:bg-white/10 ${className}`}
    >
      {resolved === "dark" ? (
        // Sun — shown when currently dark, click to go light.
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path
            d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        // Moon — shown when currently light, click to go dark.
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path
            d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
