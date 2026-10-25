"use client";

import { useEffect, useState } from "react";

/** Event-driven status; online state begins on the server for hydration safety. */
export function useDeskOffline(): boolean {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const onOffline = () => setOffline(true);
    const onOnline = () => setOffline(false);
    setOffline(!navigator.onLine);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);
  return offline;
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
    You're offline — changes are paused
  </div>;
}
