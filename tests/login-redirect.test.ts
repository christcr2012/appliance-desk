import { describe, it, expect, vi, beforeEach } from "vitest";

// @/lib/session re-exports from ./auth, which imports the Prisma client —
// not available in this sandbox (see AGENTS.md's "real constraint" note).
// Mock the whole module directly (no vi.importActual) so this test never
// touches that import chain; CI is the real gate either way.
const getServerSession = vi.fn();

vi.mock("@/lib/session", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}));

describe("getPostLoginDestination", () => {
  beforeEach(() => {
    getServerSession.mockReset();
  });

  it("sends an OWNER to Today", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1", role: "OWNER" } });
    const { getPostLoginDestination } = await import("@/app/login/actions");

    await expect(getPostLoginDestination(null)).resolves.toBe("/desk/today");
  });

  it("sends an ADMIN to Today", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1", role: "ADMIN" } });
    const { getPostLoginDestination } = await import("@/app/login/actions");

    await expect(getPostLoginDestination(null)).resolves.toBe("/desk/today");
  });

  it("sends a CUSTOMER to the account portal", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1", role: "CUSTOMER" } });
    const { getPostLoginDestination } = await import("@/app/login/actions");

    await expect(getPostLoginDestination(null)).resolves.toBe("/account");
  });

  it("defaults to the account portal when role is missing", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    const { getPostLoginDestination } = await import("@/app/login/actions");

    await expect(getPostLoginDestination(null)).resolves.toBe("/account");
  });

  it("honors a safe same-site ?next= path over the role default", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1", role: "CUSTOMER" } });
    const { getPostLoginDestination } = await import("@/app/login/actions");

    await expect(getPostLoginDestination("/account/maintenance")).resolves.toBe(
      "/account/maintenance",
    );
  });

  it("ignores an unsafe ?next= value that tries to leave the site (protocol-relative)", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1", role: "OWNER" } });
    const { getPostLoginDestination } = await import("@/app/login/actions");

    await expect(getPostLoginDestination("//evil.example")).resolves.toBe("/desk/today");
  });

  it("ignores an unsafe ?next= value that is a full external URL", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1", role: "OWNER" } });
    const { getPostLoginDestination } = await import("@/app/login/actions");

    await expect(getPostLoginDestination("https://evil.example")).resolves.toBe(
      "/desk/today",
    );
  });

  it("ignores an unsafe ?next= value using a backslash trick", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1", role: "OWNER" } });
    const { getPostLoginDestination } = await import("@/app/login/actions");

    await expect(getPostLoginDestination("/\\evil.example")).resolves.toBe("/desk/today");
  });

  it("returns /login when there is no session (sign-in didn't actually succeed)", async () => {
    getServerSession.mockResolvedValue(null);
    const { getPostLoginDestination } = await import("@/app/login/actions");

    await expect(getPostLoginDestination(null)).resolves.toBe("/login");
  });
});
