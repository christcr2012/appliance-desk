import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ACTIVE_CONTROLS = [
  "src/app/desk/activity/page.tsx",
  "src/app/desk/agreements/new/rental-wizard.tsx",
  "src/app/desk/agreements/page.tsx",
  "src/app/desk/dispatch/page.tsx",
  "src/app/desk/estimates/new/new-estimate-form.tsx",
  "src/app/desk/inventory/page.tsx",
  "src/app/desk/jobs/page.tsx",
  "src/app/desk/maintenance/page.tsx"
];

describe("Evergreen active action controls", () => {
  it("uses the action border with the action background and foreground", () => {
    const invalid = ACTIVE_CONTROLS.filter((filename) =>
      fs.readFileSync(path.join(process.cwd(), filename), "utf8")
        .includes("border-primary bg-action text-on-action"),
    );
    expect(invalid).toEqual([]);
    expect(ACTIVE_CONTROLS.some((filename) =>
      fs.readFileSync(path.join(process.cwd(), filename), "utf8")
        .includes("border-action bg-action text-on-action"),
    )).toBe(true);
  });
});
