import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// CMP-3 review fixes (PR #655): the Form 8300 draft must be downloadable
// while the filing is READY_FOR_REVIEW — the state prepareFiling actually
// sets. A stale "PREPARED" state name in the route and the page hid the
// draft until after approval. These source checks pin the real state list.
describe("CMP-3 review fixes: Form 8300 draft availability", () => {
  it("the outputs route allows the draft in READY_FOR_REVIEW and never names a PREPARED state", () => {
    const route = readFileSync("src/app/desk/compliance/[id]/outputs/route.ts", "utf8");
    const guard = route.slice(route.indexOf('filing.obligationKey === "fed.8300"'));
    expect(guard).toContain('"READY_FOR_REVIEW"');
    expect(route).not.toContain('"PREPARED"');
  });

  it("the filing page shows the draft link in READY_FOR_REVIEW", () => {
    const page = readFileSync("src/app/desk/compliance/[id]/page.tsx", "utf8");
    const formReady = page.slice(page.indexOf("const formReady"), page.indexOf(";", page.indexOf("const formReady")));
    expect(formReady).toContain('"READY_FOR_REVIEW"');
    expect(formReady).not.toContain('"PREPARED"');
  });

  it("the W-9 file download route exists and is owner/admin only", () => {
    const route = readFileSync("src/app/api/desk/suppliers/[id]/w9-file/route.ts", "utf8");
    expect(route).toContain('requireRole("OWNER", "ADMIN")');
    expect(route).toContain('access: "private"');
  });
});
