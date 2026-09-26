import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => getSession(...args) } },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

// next/navigation's redirect() throws in real Next.js (it's implemented via
// a thrown "NEXT_REDIRECT" digest that the framework catches higher up).
// We replicate that here so requireSession/requireRole's control flow
// (nothing after redirect() executes) is actually exercised.
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

describe("requireSession / requireRole", () => {
  beforeEach(() => {
    getSession.mockReset();
    redirectMock.mockClear();
  });

  it("redirects signed-out visitors to /login", async () => {
    getSession.mockResolvedValue(null);
    const { requireSession } = await import("@/lib/session");

    await expect(requireSession()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("lets a signed-in user through requireSession", async () => {
    const session = { user: { id: "u1", role: "CUSTOMER" } };
    getSession.mockResolvedValue(session);
    const { requireSession } = await import("@/lib/session");

    await expect(requireSession()).resolves.toEqual(session);
  });

  it("redirects a CUSTOMER away from an OWNER/ADMIN-only page", async () => {
    getSession.mockResolvedValue({ user: { id: "u1", role: "CUSTOMER" } });
    const { requireRole } = await import("@/lib/session");

    await expect(requireRole("OWNER", "ADMIN")).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("lets an OWNER through an OWNER/ADMIN-only page", async () => {
    const session = { user: { id: "u1", role: "OWNER" } };
    getSession.mockResolvedValue(session);
    const { requireRole } = await import("@/lib/session");

    await expect(requireRole("OWNER", "ADMIN")).resolves.toEqual(session);
  });

  it("redirects an ADMIN away from a page that requires OWNER only", async () => {
    getSession.mockResolvedValue({ user: { id: "u1", role: "ADMIN" } });
    const { requireRole } = await import("@/lib/session");

    await expect(requireRole("OWNER")).rejects.toThrow("NEXT_REDIRECT:/");
  });
});
