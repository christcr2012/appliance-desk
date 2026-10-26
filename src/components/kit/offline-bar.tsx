"use client";

import { useEffect, useSyncExternalStore } from "react";

/** Subscribe to browser connectivity with a hydration-safe server snapshot. */
function subscribeToConnectivity(onChange: () => void) {
  window.addEventListener("offline", onChange);
  window.addEventListener("online", onChange);
  return () => {
    window.removeEventListener("offline", onChange);
    window.removeEventListener("online", onChange);
  };
}

function isOffline() {
  return !navigator.onLine;
}

export function useDeskOffline(): boolean {
  return useSyncExternalStore(subscribeToConnectivity, isOffline, () => false);
}

export function OfflineBar() {
  const offline = useDeskOffline();
  useEffect(() => {
    if (offline) document.body.dataset.offline = "true";
    else delete document.body.dataset.offline;
    return () => { delete document.body.dataset.offline; };
  }, [offline]);
  if (!offline) return null;
  return <div role="status" className="sticky top-0 z-50 border-b border-warning-ink bg-warning-bg px-4 py-2 text-center text-sm font-bold text-warning-ink print:hidden">
    You&apos;re offline — changes are paused
  </div>;
}
