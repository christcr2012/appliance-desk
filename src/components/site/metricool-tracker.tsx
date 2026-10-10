"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { metricoolVisit } from "@/lib/metricool";

export function MetricoolTracker({ hash, siteOrigin }: { hash: string; siteOrigin: string }) {
  const pathname = usePathname();
  const lastVisit = useRef<string | null>(null);
  useEffect(() => {
    const visit = metricoolVisit({
      hash, siteOrigin, url: window.location.href, referrer: document.referrer,
      width: window.innerWidth, height: window.innerHeight,
      doNotTrack: navigator.doNotTrack,
      globalPrivacyControl: (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl,
    });
    if (!visit || visit === lastVisit.current) return;
    lastVisit.current = visit;
    // Best-effort analytics must never interfere with forms or navigation.
    const pixel = new Image();
    pixel.src = visit;
  }, [hash, siteOrigin, pathname]);
  return null;
}
