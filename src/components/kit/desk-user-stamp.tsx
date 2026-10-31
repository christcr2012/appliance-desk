"use client";

import { useEffect } from "react";

/**
 * AR-5 section 5: the app frame stamps the signed-in user's id in
 * sessionStorage as "desk-user" (a non-secret value) so AR-11's offline
 * page can tell whose saved route copy it may show on this device.
 */
export function DeskUserStamp({ userId }: { userId: string }) {
  useEffect(() => {
    try {
      sessionStorage.setItem("desk-user", userId);
    } catch {
      /* storage denied: the offline page falls back to its plain form */
    }
  }, [userId]);
  return null;
}
