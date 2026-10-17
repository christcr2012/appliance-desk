import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pathname: "/desk/jobs/abc", role: "OWNER" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("@/lib/session", () => ({
  getServerSession: async () => ({ user: { role: state.role } }),
  requireSession: async () => ({ user: { role: state.role } }),
}));
vi.mock("@/components/ui", () => ({
  Card: ({ title, children }: { title: string; children: React.ReactNode }) => <section><h2>{title}</h2>{children}</section>,
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

import { SectionTabs } from "@/components/desk/section-tabs";
import MorePage from "@/app/desk/more/page";

afterEach(cleanup);

describe("W-8 section tabs", () => {
  it("shows the three Schedule views and marks the current one", async () => {
    render(await SectionTabs({ section: "schedule" }));
    const nav = screen.getByRole("navigation", { name: "Schedule sections" });
    const links = Array.from(nav.querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Dispatch board", "/desk/dispatch"], ["Jobs", "/desk/jobs"], ["Driver view", "/desk/driver"],
    ]);
    expect(screen.getByRole("link", { name: "Jobs" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Driver view" }).hasAttribute("aria-current")).toBe(false);
  });

  it("gives staff only Inventory and Parts under Equipment, and no Money tabs at all", async () => {
    state.role = "STAFF";
    state.pathname = "/desk/parts";
    render(await SectionTabs({ section: "equipment" }));
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["Inventory", "Parts"]);
    cleanup();
    const money = await SectionTabs({ section: "money" });
    expect(money).toBeNull();
    state.role = "OWNER";
  });

  it("More lists screens for the role, each with a plain explanation", async () => {
    state.role = "OWNER";
    render(await MorePage());
    expect(screen.getByRole("heading", { level: 1, name: "More" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Privacy requests" }).getAttribute("href")).toBe("/desk/privacy");
    expect(screen.getByText("Who changed what, and when.")).toBeTruthy();
    cleanup();
    state.role = "STAFF";
    render(await MorePage());
    expect(screen.queryByRole("link", { name: "Privacy requests" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Suppliers" })).toBeNull();
    expect(screen.getByRole("link", { name: "Activity" })).toBeTruthy();
  });
});
