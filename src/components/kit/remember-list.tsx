"use client";

import { useEffect, type MouseEvent } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** Only list landing screens, never arbitrary record URLs or external links. */
export const REMEMBERED_LIST_PATHS = new Set([
  "/desk/today", "/desk/billing", "/desk/customers", "/desk/agreements",
  "/desk/inventory", "/desk/jobs", "/desk/dispatch", "/desk/leads",
  "/desk/estimates", "/desk/expenses", "/desk/purchases", "/desk/tasks",
  "/desk/collections",
]);
export type ListPosition = { search: string; scrollY: number };
const keyFor = (path: string) => `list:${path}`;
// Revokes in-flight list subscriptions when sign-out clears tab-owned state.
let memoryEpoch = 0;

export function readListPosition(path: string): ListPosition | null {
  if (!REMEMBERED_LIST_PATHS.has(path) || typeof window === "undefined") return null;
  try {
    const text = sessionStorage.getItem(keyFor(path));
    if (!text) return null;
    const candidate: unknown = JSON.parse(text);
    if (!candidate || typeof candidate !== "object") return null;
    const value = candidate as Record<string, unknown>;
    if (typeof value.search !== "string" || value.search.length > 600 ||
      (value.search !== "" && !value.search.startsWith("?")) ||
      typeof value.scrollY !== "number" || !Number.isFinite(value.scrollY) ||
      value.scrollY < 0 || value.scrollY > 1_000_000) return null;
    return { search: value.search, scrollY: value.scrollY };
  } catch {
    // Storage is often unavailable in private browsing; do not break a link.
    return null;
  }
}

export function saveListPosition(path: string, search: string, scrollY: number): void {
  if (!REMEMBERED_LIST_PATHS.has(path) || typeof window === "undefined") return;
  if (search.length > 600 || (search !== "" && !search.startsWith("?"))) return;
  try {
    sessionStorage.setItem(keyFor(path), JSON.stringify({
      search,
      scrollY: Number.isFinite(scrollY) ? Math.max(0, Math.min(scrollY, 1_000_000)) : 0,
    }));
  } catch { /* storage disabled; normal navigation still works */ }
}

export function rememberedListHref(href: string): string {
  if (href.includes("?") || href.includes("#") || !REMEMBERED_LIST_PATHS.has(href)) return href;
  const stored = readListPosition(href);
  return stored?.search ? href + stored.search : href;
}

/** Return true when a normal same-tab click follows a remembered filter. */
export function followRememberedClick(
  event: Pick<MouseEvent<HTMLAnchorElement>, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented" | "preventDefault">,
  href: string,
  navigate: (next: string) => void,
): boolean {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const remembered = rememberedListHref(href);
  if (remembered === href) return false;
  event.preventDefault();
  navigate(remembered);
  return true;
}

export function clearRememberedLists(): void {
  memoryEpoch += 1;
  if (typeof window === "undefined") return;
  try {
    const keys = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i));
    for (const key of keys) if (key?.startsWith("list:/desk/")) sessionStorage.removeItem(key);
  } catch { /* privacy clearing cannot prevent sign-out */ }
}

/** Desk shell subscription keeps each list's place without persisting private HTML or fetched data. */
export function RememberList() {
  const pathname = usePathname() ?? "";
  const search = useSearchParams()?.toString() ?? "";
  useEffect(() => {
    if (!REMEMBERED_LIST_PATHS.has(pathname)) return;
    const query = search ? `?${search}` : "";
    const epoch = memoryEpoch;
    let scrollY = window.scrollY;
    const previous = readListPosition(pathname);
    let frame: number | null = null;
    let expiry: number | null = null;
    let observer: MutationObserver | null = null;
    if (previous && previous.search === query && previous.scrollY > 0) {
      const tryRestore = () => {
        if (memoryEpoch !== epoch) return;
        const root = document.scrollingElement ?? document.documentElement;
        // The page may still be the much shorter loading skeleton. Restore only
        // once its streamed content is tall enough to hold the saved position.
        if (root.scrollHeight - window.innerHeight + 1 < previous.scrollY) return;
        window.scrollTo({ top: previous.scrollY, behavior: "auto" });
        observer?.disconnect();
        if (expiry !== null) window.clearTimeout(expiry);
      };
      observer = new MutationObserver(tryRestore);
      observer.observe(document.getElementById("main-content") ?? document.body, { childList: true, subtree: true });
      expiry = window.setTimeout(() => {
        observer?.disconnect();
        if (memoryEpoch === epoch) {
          const root = document.scrollingElement ?? document.documentElement;
          window.scrollTo({ top: Math.min(previous.scrollY, Math.max(0, root.scrollHeight - window.innerHeight)), behavior: "auto" });
        }
      }, 7000);
      frame = requestAnimationFrame(tryRestore);
    }
    const onScroll = () => { scrollY = window.scrollY; };
    const save = () => {
      if (memoryEpoch === epoch) saveListPosition(pathname, query, scrollY);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", save);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (expiry !== null) window.clearTimeout(expiry);
      observer?.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [pathname, search]);
  return null;
}
