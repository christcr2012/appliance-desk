import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  pathname: "/desk/today",
  push: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock("@/lib/auth-client", () => ({
  signOut: mocks.signOut,
}));

vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));

vi.mock("@/components/global-search-box", () => ({
  GlobalSearchBox: () => (
    <form action="/desk/search">
      <label htmlFor="mock-search">Search desk</label>
      <input id="mock-search" />
    </form>
  ),
}));

vi.mock("next/image", () => ({
  default: ({ src }: { src: string }) => (
    <span data-image-src={src} aria-hidden="true" />
  ),
}));

import { AppShell } from "@/components/ui/app-shell";
import { deskNavigation } from "@/lib/desk-navigation";

beforeEach(() => {
  mocks.pathname = "/desk/today";
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.signOut.mockClear();

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });

  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    },
  });
});

afterEach(cleanup);

describe.each(["light", "dark"] as const)("E2 AppShell in %s mode", (mode) => {
  it("derives owner tabs from allowed navigation and keeps current-page semantics", () => {
    render(
      <div className={mode === "dark" ? "dark" : undefined}>
        <AppShell nav={deskNavigation("OWNER")} role="OWNER">
          <h1>Today content</h1>
        </AppShell>
      </div>,
    );

    const mainNav = screen.getByRole("navigation", { name: "Main" });
    expect(mainNav.getAttribute("aria-label")).toBe("Main");
    for (const label of ["Today", "Schedule", "Customers", "Billing"]) {
      expect(
        mainNav.querySelector(`a[href]${label === "Today" ? '[aria-current="page"]' : ""}`),
      ).toBeTruthy();
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole("button", { name: "More navigation" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Search" }).getAttribute("href")).toBe(
      "/desk/search",
    );
    expect(screen.getByRole("heading", { level: 1, name: "Today content" })).toBeTruthy();
  });

  it("never puts finance destinations in staff phone tabs or full navigation", () => {
    render(
      <div className={mode === "dark" ? "dark" : undefined}>
        <AppShell nav={deskNavigation("STAFF")} role="STAFF">
          <h1>Staff today</h1>
        </AppShell>
      </div>,
    );

    const mainNav = screen.getByRole("navigation", { name: "Main" });
    for (const label of ["Today", "Schedule", "Jobs", "Inventory"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(mainNav.textContent).not.toContain("Billing");

    fireEvent.click(screen.getByRole("button", { name: "More navigation" }));
    const dialog = screen.getByRole("dialog", { name: "Appliance Desk" });
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.textContent).not.toContain("Billing");
    expect(dialog.textContent).not.toContain("Privacy requests");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(dialog.hasAttribute("open")).toBe(false);
  });
});
