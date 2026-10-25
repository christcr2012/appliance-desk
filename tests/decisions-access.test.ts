import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// DEC-1b: who may use the Decisions & reviews screens and file routes. Owner acts; admins read only; staff refused.
const s = vi.hoisted(() => ({ user: null as null | { id: string; role: string; archivedAt: Date | null }, twoFactor: false }));
vi.mock("@/lib/session", () => ({ getServerSession: async () => (s.user ? { user: s.user } : null) }));
vi.mock("@/domains/security/two-factor", () => ({ twoFactorEnrollmentRequired: async () => s.twoFactor }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: async () => false }));

import { guardDecisionRequest } from "@/app/api/desk/decisions/guard";

const post = (origin = "https://desk.example") =>
  new Request("https://desk.example/api/desk/decisions/answer", { method: "POST", headers: { origin } });

beforeEach(() => {
  s.user = null;
  s.twoFactor = false;
});

describe("file routes front door", () => {
  it("lets the owner write and refuses admins, staff, customers and signed-out people", async () => {
    s.user = { id: "o", role: "OWNER", archivedAt: null };
    expect(await guardDecisionRequest(post(), ["OWNER"], { write: true })).toMatchObject({ ok: true, userId: "o" });
    for (const role of ["ADMIN", "STAFF", "CUSTOMER", "", undefined]) {
      s.user = { id: "x", role: role as string, archivedAt: null };
      const result = await guardDecisionRequest(post(), ["OWNER"], { write: true });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(403);
    }
    s.user = null;
    const out = await guardDecisionRequest(post(), ["OWNER"], { write: true });
    expect(!out.ok && out.response.status).toBe(401);
  });

  it("lets admins read stored forms but never staff", async () => {
    s.user = { id: "a", role: "ADMIN", archivedAt: null };
    expect((await guardDecisionRequest(new Request("https://desk.example/x"), ["OWNER", "ADMIN"])).ok).toBe(true);
    s.user = { id: "s", role: "STAFF", archivedAt: null };
    expect((await guardDecisionRequest(new Request("https://desk.example/x"), ["OWNER", "ADMIN"])).ok).toBe(false);
  });

  it("refuses posts from another site, deactivated owners and owners without two-step login", async () => {
    s.user = { id: "o", role: "OWNER", archivedAt: null };
    expect((await guardDecisionRequest(post("https://evil.example"), ["OWNER"], { write: true })).ok).toBe(false);
    s.user = { id: "o", role: "OWNER", archivedAt: new Date() };
    expect((await guardDecisionRequest(post(), ["OWNER"], { write: true })).ok).toBe(false);
    s.user = { id: "o", role: "OWNER", archivedAt: null };
    s.twoFactor = true;
    expect((await guardDecisionRequest(post(), ["OWNER"], { write: true })).ok).toBe(false);
  });
});

describe("screens and actions", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  it("the list and download allow owner and admin; every action and import is owner only", () => {
    expect(read("src/app/desk/settings/decisions/page.tsx")).toContain('requireRole("OWNER", "ADMIN")');
    expect(read("src/app/desk/settings/decisions/form/route.ts")).toContain('requireRole("OWNER", "ADMIN")');
    expect(read("src/app/desk/settings/decisions/import/page.tsx")).toContain('requireRole("OWNER")');
    const actions = read("src/app/desk/settings/decisions/actions.ts");
    expect(actions.match(/export async function/g)).toHaveLength(4);
    expect(actions.match(/requireRole\("OWNER"\)/g)).toHaveLength(4);
    expect(read("src/app/api/desk/decisions/answer/route.ts")).toContain('["OWNER"], { write: true }');
    expect(read("src/app/api/desk/decisions/import/route.ts")).toContain('["OWNER"], { write: true }');
  });

  it("the server pages never call the kit's client-only helpers (React error 441 took the whole screen down)", () => {
    for (const file of ["src/app/desk/settings/decisions/page.tsx", "src/app/desk/settings/decisions/import/page.tsx"]) {
      expect(read(file)).not.toMatch(/actionButtonClass\(/);
    }
  });

  it("admins get the cards without any buttons", () => {
    expect(read("src/app/desk/settings/decisions/page.tsx")).toMatch(/\{isOwner \? \(\s*<DecisionActions/);
  });
});
