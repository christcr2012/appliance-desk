"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { saveRouteSnapshot, type RouteSnapshotData } from "@/lib/route-snapshot";

/**
 * AR-5 section 5: on every successful render of My route, keep the on-device
 * copy of today's route current. Renders nothing; a browser that refuses
 * IndexedDB just never gets the offline copy.
 *
 * It also warms the offline page while the connection is up: AR-11's service
 * worker precaches the /offline HTML but not this page's own scripts, so the
 * saved-route island on it can only run offline if its code was fetched once
 * online — the prefetch pulls exactly those files through the worker's
 * static-asset cache.
 */
export function RouteSnapshot({ snapshot }: { snapshot: RouteSnapshotData }) {
  const router = useRouter();
  useEffect(() => {
    void saveRouteSnapshot(snapshot);
    router.prefetch("/offline");
  }, [snapshot, router]);
  return null;
}
