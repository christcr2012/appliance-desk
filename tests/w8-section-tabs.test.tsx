import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pathname: "/desk/jobs/abc", role: "OWNER" }));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  redirect: (path: string) => { throw new Error("NEXT_REDIRECT " + path); },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("@/lib/session", () => ({
  getServerSession: async () => ({ user: { id: "w8-user", role: state.role } }),
  requireSession: async () => ({ user: { id: "w8-user", role: state.role } }),
}));
vi.mock("@/lib/job-role-guard", () => ({ jobRoleScreens: async () => null })); // ACC-5: no job role, so the access level alone decides
vi.mock("@/domains/features", () => ({ getShownFeatures: async () => new Set(["team"]) }));
vi.mock("@/components/ui", () => ({
  Card: ({ title, children }: { title: string; children: React.ReactNode }) => <section><h2>{title}</h2>{children}</section>,
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

import { AreaLayout } from "@/components/kit/area-layout";
import MorePage from "@/app/desk/more/page";

afterEach(cleanup);

describe("W-8 section tabs (kit AreaLayout since AR-10)", () => {
  it("shows the four Schedule views and marks the current one", async () => {
    render(await AreaLayout({ area: "schedule", children: <p>page</p> }));
    const nav = screen.getByRole("navigation", { name: "Schedule sections" });
    const links = Array.from(nav.querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Board", "/desk/dispatch"], ["Visits", "/desk/jobs"],
      ["My route", "/desk/driver"], ["Repairs", "/desk/maintenance"],
    ]);
    expect(screen.getByRole("link", { name: "Visits" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "My route" }).hasAttribute("aria-current")).toBe(false);
  });

  it("gives staff only Fleet and Parts under Equipment, and no Money tabs at all", async () => {
    state.role = "STAFF";
    state.pathname = "/desk/parts";
    render(await AreaLayout({ area: "equipment", children: <p>page</p> }));
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["Fleet", "Parts"]);
    cleanup();
    render(await AreaLayout({ area: "money", children: <p>page</p> }));
    expect(screen.queryByRole("navigation")).toBeNull();
    state.role = "OWNER";
  });

  it("redirects the retired More page to Today for both owner and staff", () => {
    for (const role of ["OWNER", "STAFF"]) {
      state.role = role;
      expect(() => MorePage()).toThrow("NEXT_REDIRECT /desk/today");
    }
    state.role = "OWNER";
  });
});
