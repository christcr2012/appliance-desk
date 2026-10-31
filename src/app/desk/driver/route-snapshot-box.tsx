"use client";

import { useEffect } from "react";
import { saveRouteSnapshot, type RouteSnapshotData } from "@/lib/route-snapshot";

/**
 * AR-5 section 5: on every successful render of My route, keep the on-device
 * copy of today's route current. Renders nothing; a browser that refuses
 * IndexedDB just never gets the offline copy.
 */
export function RouteSnapshot({ snapshot }: { snapshot: RouteSnapshotData }) {
  useEffect(() => {
    void saveRouteSnapshot(snapshot);
  }, [snapshot]);
  return null;
}
