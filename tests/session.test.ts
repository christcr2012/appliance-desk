import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn();
const twoFactorEnrollmentRequired = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => getSession(...args) } },
}));

vi.mock("@/domains/security/two-factor", () => ({
  twoFactorEnrollmentRequired: (...args: unknown[]) =>
    twoFactorEnrollmentRequired(...args),
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
    twoFactorEnrollmentRequired.mockReset();
    twoFactorEnrollmentRequired.mockResolvedValue(false);
    redirectMock.mockClear();
  });

  it("redirects signed-out visitors to /login", async () => {
    getSession.mockResolvedValue(null);
    const { requireSession } = await import("@/lib/session");

    await expect(requireSession()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("lets a signed-in user through requireSession", async () => {
    const session = { user: { id: "u1", role: "CUSTOMER", archivedAt: null } };
    getSession.mockResolvedValue(session);
    const { requireSession } = await import("@/lib/session");

    await expect(requireSession()).resolves.toEqual(session);
  });

  it("redirects a CUSTOMER away from an OWNER/ADMIN-only page", async () => {
    getSession.mockResolvedValue({ user: { id: "u1", role: "CUSTOMER", archivedAt: null } });
    const { requireRole } = await import("@/lib/session");

    await expect(requireRole("OWNER", "ADMIN")).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("lets an OWNER through an OWNER/ADMIN-only page", async () => {
    const session = { user: { id: "u1", role: "OWNER", archivedAt: null } };
    getSession.mockResolvedValue(session);
    const { requireRole } = await import("@/lib/session");

    await expect(requireRole("OWNER", "ADMIN")).resolves.toEqual(session);
  });

  it("redirects a required unenrolled OWNER to two-factor setup", async () => {
    getSession.mockResolvedValue({ user: { id: "u1", role: "OWNER", archivedAt: null } });
    twoFactorEnrollmentRequired.mockResolvedValue(true);
    const { requireRole } = await import("@/lib/session");

    await expect(requireRole("OWNER")).rejects.toThrow(
      "NEXT_REDIRECT:/desk/security/setup",
    );
  });

  it("redirects an ADMIN away from a page that requires OWNER only", async () => {
    getSession.mockResolvedValue({ user: { id: "u1", role: "ADMIN", archivedAt: null } });
    const { requireRole } = await import("@/lib/session");

    await expect(requireRole("OWNER")).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it.each([
    {}, { user: null }, { user: {} },
    { user: { id: "", role: "OWNER", archivedAt: null } },
    { user: { id: 123, role: "OWNER", archivedAt: null } },
    { user: { id: "u1", archivedAt: null } },
    { user: { id: "u1", role: "SUPERUSER", archivedAt: null } },
    { user: { id: "u1", role: "CUSTOMER" } },
  ])("denies a malformed or incomplete provider payload: %j", async (session) => {
    getSession.mockResolvedValue(session);
    const { getServerSession, requireSession, requireRole } = await import("@/lib/session");
    await expect(getServerSession()).resolves.toBeNull();
    await expect(requireSession()).rejects.toThrow("NEXT_REDIRECT:/login");
    await expect(requireRole("CUSTOMER", "OWNER")).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it.each([new Date("2026-09-30T12:00:00Z"), "2026-09-30T12:00:00Z", "", false])("denies every non-null archive state without losing the deactivation redirect", async (archivedAt) => {
    getSession.mockResolvedValue({ user: { id: "u1", role: "OWNER", archivedAt } });
    const { getServerSession, requireSession } = await import("@/lib/session");
    await expect(getServerSession()).resolves.toBeNull();
    await expect(requireSession()).rejects.toThrow("NEXT_REDIRECT:/login?deactivated=1");
  });
});
