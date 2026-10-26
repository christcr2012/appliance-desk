import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DEC-1b: the weekly "Decisions waiting" card remembers the day it was shown in the owner's workspace preferences.
 * That write re-checks the owner inside its own transaction and locks the row first (fakes record every call).
 */
const m = vi.hoisted(() => {
  const log: string[] = [];
  const state = { role: "OWNER", archived: false };
  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      log.push(sql.includes('"User"') ? "lock:user" : sql.includes("FOR UPDATE") ? "lock:prefs" : "raw");
      return [];
    }),
    $executeRaw: vi.fn(async (strings: TemplateStringsArray) => {
      log.push(strings.join("?").includes("INSERT") ? "insert:prefs" : "update:prefs");
      return 1;
    }),
    user: { findUnique: vi.fn(async () => (log.push("read:user"),
      { id: "owner", role: state.role, archivedAt: state.archived ? new Date() : null })) },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (t: typeof tx) => unknown) => callback(tx)),
    $executeRaw: vi.fn(async () => (log.push("write:outside-transaction"), 1)),
    ownerWorkspacePreference: { findUnique: vi.fn(async () => null) },
    decisionRecord: { findMany: vi.fn(async () => []) },
  };
  return { log, state, prisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: m.prisma }));
vi.mock("@/lib/report-error", () => ({ reportBackgroundError: vi.fn(async () => undefined) }));

import { decisionsTodayCount, noteDecisionsCardShown } from "@/domains/decisions/today";

beforeEach(() => {
  m.log.length = 0;
  m.state.role = "OWNER";
  m.state.archived = false;
});

describe("remembering the day the Decisions card was shown", () => {
  it("re-checks the owner, then creates and locks the row before changing it, all in one transaction", async () => {
    await noteDecisionsCardShown("owner", "2026-10-26");
    expect(m.log).toEqual(["lock:user", "read:user", "insert:prefs", "lock:prefs", "update:prefs"]);
    expect(m.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("a deactivated owner (or anyone else) writes nothing", async () => {
    m.state.archived = true;
    await expect(noteDecisionsCardShown("owner", "2026-10-26")).rejects.toThrow(/no longer has access/);
    m.state.archived = false;
    m.state.role = "ADMIN";
    await expect(noteDecisionsCardShown("owner", "2026-10-26")).rejects.toThrow(/no longer has access/);
    expect(m.log.filter((entry) => /insert|update|write/.test(entry))).toEqual([]);
  });

  it("Today still loads for a deactivated owner: no card and no write", async () => {
    m.state.archived = true;
    expect(await decisionsTodayCount({ id: "owner", role: "OWNER" }, new Date("2026-10-26T18:00:00Z"))).toBeNull();
    expect(m.log.filter((entry) => /insert|update|write/.test(entry))).toEqual([]);
  });

  it("an active owner sees the count and the day is remembered", async () => {
    expect(await decisionsTodayCount({ id: "owner", role: "OWNER" }, new Date("2026-10-26T18:00:00Z"))).toBeGreaterThan(30);
    expect(m.log).toContain("update:prefs");
  });
});
