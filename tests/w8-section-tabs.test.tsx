import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pathname: "/desk/jobs/abc", role: "OWNER" }));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  // AR-1: /desk/more redirects to Today; the mock surfaces the target as a thrown tag.
  redirect: (url: string) => { throw new Error("NEXT_REDIRECT " + url); },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("@/lib/session", () => ({
  getServerSession: async () => ({ user: { role: state.role } }),
  requireSession: async () => ({ user: { role: state.role } }),
}));
vi.mock("@/lib/job-role-guard", () => ({ jobRoleScreens: async () => null })); // ACC-5: no job role, so the access level alone decides
vi.mock("@/components/ui", () => ({
  Card: ({ title, children }: { title: string; children: React.ReactNode }) => <section><h2>{title}</h2>{children}</section>,
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

import { SectionTabs } from "@/components/desk/section-tabs";
import MorePage from "@/app/desk/more/page";

afterEach(cleanup);

describe("W-8 section tabs", () => {
  it("shows the Schedule area tabs and marks the current one", async () => {
    render(await SectionTabs({ section: "schedule" }));
    const nav = screen.getByRole("navigation", { name: "Schedule sections" });
    const links = Array.from(nav.querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("href")]);
    // AR-1: the section wrapper serves the Schedule area's tabs (Board, Visits, My route, Repairs).
    expect(links).toEqual([
      ["Board", "/desk/dispatch"], ["Visits", "/desk/jobs"], ["My route", "/desk/driver"], ["Repairs", "/desk/maintenance"],
    ]);
    expect(screen.getByRole("link", { name: "Visits" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "My route" }).hasAttribute("aria-current")).toBe(false);
  });

  it("gives staff only Fleet and Parts under Equipment, and no Money tabs at all", async () => {
    state.role = "STAFF";
    state.pathname = "/desk/parts";
    render(await SectionTabs({ section: "equipment" }));
    // AR-1: the inventory screen is the Equipment area's "Fleet" tab (same /desk/inventory address).
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["Fleet", "Parts"]);
    cleanup();
    const money = await SectionTabs({ section: "money" });
    expect(money).toBeNull();
    state.role = "OWNER";
  });

  it("the old More page redirects everyone to Today (AR-1: its screens live in the profile menu now)", async () => {
    // The role-filtered rarely-used screens themselves are covered through
    // visibleProfileLinks in tests/desk-areas.test.ts and tests/w8-menu-sections.test.ts.
    state.role = "OWNER";
    expect(() => MorePage()).toThrow("NEXT_REDIRECT /desk/today");
    state.role = "STAFF";
    expect(() => MorePage()).toThrow("NEXT_REDIRECT /desk/today");
  });
});
