import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const deskRoot = path.join(process.cwd(), "src/app/desk");

function allTopLevelAreas(): string[] {
  return fs.readdirSync(deskRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(deskRoot, name, "page.tsx")))
    .sort();
}

describe("AR-11 never-blank desk route loading", () => {
  it("adds an accessible kit loading screen in every top-level desk area", () => {
    const areas = allTopLevelAreas();
    expect(areas.length).toBeGreaterThan(40);
    for (const area of areas) {
      const file = path.join(deskRoot, area, "loading.tsx");
      expect(fs.existsSync(file), `Missing loading.tsx for /desk/${area}`).toBe(true);
      const content = fs.readFileSync(file, "utf8");
      expect(content, `Use the shared kit in /desk/${area}`).toContain('from "@/components/kit"');
      expect(content, `No blank placeholder for /desk/${area}`).toMatch(/<(ListSkeleton|RecordSkeleton|InboxSkeleton)\s+label=/);
      expect(content).not.toMatch(/<div\s*\/>/);
    }
  });
  it("uses the same kit loading state as a fallback for nested and new routes", () => {
    const content = fs.readFileSync(path.join(deskRoot, "loading.tsx"), "utf8");
    expect(content).toContain("ListSkeleton");
    expect(content).toContain('label="Loading desk…"');
  });
  it("keeps the kit's status, reduced motion and nonblank card skeletons", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/components/kit/skeleton.tsx"), "utf8");
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-busy="true"');
    expect(source).toContain("motion-reduce:animate-none");
    expect(source).toContain("length: 6");
  });
});
