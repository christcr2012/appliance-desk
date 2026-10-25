// Shared set-up for the AR-0 kit component tests: a controllable next/navigation and the few browser APIs that
// Radix and vaul expect but jsdom lacks. Each test file does:
//   vi.mock("next/navigation", () => import("./kit-test-env"));
import { vi } from "vitest";

export const nav = {
  pathname: "/desk/billing",
  search: "",
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
};

export function resetNav(pathname = "/desk/billing", search = "") {
  nav.pathname = pathname;
  nav.search = search;
  for (const key of ["push", "replace", "refresh", "prefetch", "back", "forward"] as const) nav[key].mockReset();
}

export function useRouter() {
  return nav;
}
export function usePathname() {
  return nav.pathname;
}
export function useSearchParams() {
  return new URLSearchParams(nav.search);
}
export function unstable_rethrow(error: unknown) {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest === "string" && digest.startsWith("NEXT_")) throw error;
}

/** Make `(min-width: 1024px)` match (desktop) or not (phone). */
export function setDesktop(desktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("min-width: 1024px") ? desktop : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (typeof window !== "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub;
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.scrollIntoView ??= function () {};
  proto.hasPointerCapture ??= function () {
    return false;
  };
  proto.setPointerCapture ??= function () {};
  proto.releasePointerCapture ??= function () {};
  setDesktop(false);
}

/** Open a Radix dropdown trigger the way a keyboard user does. */
export async function openMenu(trigger: HTMLElement) {
  const { act, fireEvent } = await import("@testing-library/react");
  await act(async () => {
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
  });
}
