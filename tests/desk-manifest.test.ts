import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "public/desk.webmanifest"), "utf8"));

describe("AR-11 installable desk manifest", () => {
  it("opens the desk, not the public website", () => {
    expect(manifest.id).toBe("/desk/today");
    expect(manifest.start_url).toBe("/desk/today");
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
    expect(manifest.display).toBe("standalone");
    expect(manifest.display_override).toContain("standalone");
    expect(manifest.name).toBe("Appliance Desk");
  });
  it("has the brand icons and four working routes", () => {
    expect(manifest.icons).toHaveLength(3);
    for (const icon of manifest.icons) {
      expect(fs.existsSync(path.join(process.cwd(), "public", icon.src.slice(1)))).toBe(true);
    }
    expect(manifest.shortcuts.map((s: {name: string}) => s.name)).toEqual([
      "New quote", "Take a payment", "Today's route", "Add an expense",
    ]);
    for (const shortcut of manifest.shortcuts) {
      const url = new URL(shortcut.url, "https://example.test");
      expect(url.pathname.startsWith("/desk/")).toBe(true);
      expect(fs.existsSync(path.join(process.cwd(), "src/app", url.pathname, "page.tsx"))).toBe(true);
    }
    expect(fs.readFileSync("src/app/desk/expenses/page.tsx", "utf8")).toContain('id="add-expense"');
  });
});
