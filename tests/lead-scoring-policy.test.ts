import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  settingsFindUnique: vi.fn(),
  settingsUpsert: vi.fn(),
  auditCreate: vi.fn(),
  leadUpdateMany: vi.fn(),
  assertActor: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        $queryRaw: (strings: TemplateStringsArray) => m.queryRaw(strings),
        businessSettings: {
          findUnique: (args: unknown) => m.settingsFindUnique(args),
          upsert: (args: unknown) => m.settingsUpsert(args),
        },
        auditLog: { create: (args: unknown) => m.auditCreate(args) },
        lead: { updateMany: (args: unknown) => m.leadUpdateMany(args) },
      }),
  },
}));
vi.mock("@/lib/team-actor", () => ({
  assertActiveTeamActor: (...args: unknown[]) => m.assertActor(...args),
}));

import {
  DEFAULT_LEAD_SCORING_POLICY,
  parseLeadScoringPolicy,
  saveLeadScoringPolicy,
} from "@/domains/leads/scoring-policy";

describe("versioned lead scoring policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.queryRaw.mockResolvedValue([{ id: "singleton" }]);
    m.assertActor.mockResolvedValue({ id: "owner-1", role: "OWNER" });
    m.settingsFindUnique.mockResolvedValue({
      leadScoringPolicy: { ...DEFAULT_LEAD_SCORING_POLICY, version: 4 },
    });
    m.settingsUpsert.mockResolvedValue({});
    m.auditCreate.mockResolvedValue({});
  });

  it("fails closed to the approved v1 defaults when stored JSON is invalid", () => {
    expect(parseLeadScoringPolicy({ version: "bad" })).toEqual(DEFAULT_LEAD_SCORING_POLICY);
  });

  it("increments the policy version without silently touching existing leads", async () => {
    const saved = await saveLeadScoringPolicy("owner-1", {
      termPoints: { "month-to-month": 1, "6-month": 12, "12-month": 24 },
      additionalUnitPoints: 6,
      businessAccountPoints: 11,
      multiUnitPropertyManagerPoints: 26,
      highValueThreshold: 35,
    });

    expect(saved.version).toBe(5);
    const upsert = m.settingsUpsert.mock.calls[0]?.[0] as {
      update: { leadScoringPolicy: { version: number } };
    };
    expect(upsert.update.leadScoringPolicy.version).toBe(5);
    expect(m.auditCreate).toHaveBeenCalledTimes(1);
    expect(m.leadUpdateMany).not.toHaveBeenCalled();
  });
});
