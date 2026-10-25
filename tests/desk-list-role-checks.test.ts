import { describe, expect, it, vi } from "vitest";

// Security fix 2026-10-25: these list reads were protected only by the desk layout. Next.js layouts do not re-run on
// every navigation, so each read must check the role itself (AGENTS section 4: filter at the query boundary).
const { refused, touched } = vi.hoisted(() => ({ refused: new Error("NOT_ALLOWED"), touched: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireRole: vi.fn().mockRejectedValue(refused) }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: () => new Proxy({}, { get: () => (...args: unknown[]) => { touched(...args); return Promise.resolve([]); } }) }),
}));

import { getCustomersCount, getCustomersPage } from "@/domains/customers";
import { getMaintenanceRequestsCount, getMaintenanceRequestsPage } from "@/domains/maintenance";
import { getAllPartRecords } from "@/domains/inventory";
import { getLowStockParts } from "@/domains/purchasing";

describe("desk list reads refuse anyone the session check refuses", () => {
  it.each([
    ["getCustomersCount", () => getCustomersCount()],
    ["getCustomersPage", () => getCustomersPage(0, 25)],
    ["getMaintenanceRequestsCount", () => getMaintenanceRequestsCount()],
    ["getMaintenanceRequestsPage", () => getMaintenanceRequestsPage(undefined, 0, 25)],
    ["getAllPartRecords", () => getAllPartRecords()],
    ["getLowStockParts", () => getLowStockParts()],
  ])("%s checks the role before reading", async (_name, read) => {
    touched.mockClear();
    await expect(read()).rejects.toBe(refused);
    expect(touched).not.toHaveBeenCalled();
  });
});
