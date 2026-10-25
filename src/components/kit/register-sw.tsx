"use client";

import { useEffect } from "react";

/** No worker in dev or normal browser tests; explicit opt-in for isolated offline tests. */
export function RegisterDeskServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    if (navigator.webdriver) {
      try {
        if (localStorage.getItem("desk-sw-test") !== "on") return;
      } catch {
        return;
      }
    }
    void navigator.serviceWorker.register("/desk-sw.js", { scope: "/desk/" }).catch(() => {
      // Install is optional. A failed registration must not block normal online work.
    });
  }, []);
  return null;
}
