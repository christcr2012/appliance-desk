import { describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/session";

// AR-6 fix 1 (spec EQUIPMENT section 1): the twelve inventory/purchasing
// reads carry their own role check — layouts do not re-run on navigation,
// so the check lives in the function. The mocked requireRole enforces its
// real contract (throws when the session role is not in the allowed list);
// what is under test is WHICH list each function passes, proven by the
// disallowed calls failing before any data comes back.
const { session } = vi.hoisted(() => ({
  session: { role: "OWNER" as Role },
}));
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn(async (...roles: Role[]) => {
    if (!roles.includes(session.role)) {
      throw new Error(`Role ${session.role} is not allowed here.`);
    }
    return { user: { id: "role-check-user", role: session.role } };
  }),
}));

import {
  getApplianceCountsByStatus,
  getAppliances,
  getAppliancesCount,
  getAppliancesPage,
  getPartRecordsForModel,
} from "@/domains/inventory";
import {
  getPurchaseOrderById,
  getPurchaseOrders,
  getSupplierById,
  getSuppliers,
} from "@/domains/purchasing";
import {
  countPurchases,
  getPurchaseDetail,
  listPurchases,
} from "@/domains/purchasing/purchases";

// Disposable CI Postgres only (same gate as the other integration tests).
const url = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return null;
  }
})();
const enabled =
  process.env.CI === "true" &&
  url !== null &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const inventoryReads: Array<[string, () => Promise<unknown>]> = [
  ["getApplianceCountsByStatus", () => getApplianceCountsByStatus()],
  ["getAppliances", () => getAppliances()],
  ["getAppliancesCount", () => getAppliancesCount()],
  ["getAppliancesPage", () => getAppliancesPage(undefined, 0, 10)],
  ["getPartRecordsForModel", () => getPartRecordsForModel("AR6-NO-SUCH-MODEL")],
];

const purchasingReads: Array<[string, () => Promise<unknown>]> = [
  ["getPurchaseOrders", () => getPurchaseOrders()],
  ["getPurchaseOrderById", () => getPurchaseOrderById("ar6-no-such-order")],
  ["getSuppliers", () => getSuppliers()],
  ["getSupplierById", () => getSupplierById("ar6-no-such-supplier")],
  ["listPurchases", () => listPurchases()],
  ["countPurchases", () => countPurchases()],
  ["getPurchaseDetail", () => getPurchaseDetail("ar6-no-such-purchase")],
];

describe.skipIf(!enabled)("AR-6 fix 1: role checks on inventory and purchasing reads", () => {
  it("inventory reads allow OWNER, ADMIN and STAFF", async () => {
    for (const role of ["OWNER", "ADMIN", "STAFF"] as Role[]) {
      session.role = role;
      for (const [name, read] of inventoryReads) {
        await expect(read(), `${name} as ${role}`).resolves.toBeDefined();
      }
    }
  });

  it("inventory reads refuse CUSTOMER and ACCOUNTANT", async () => {
    for (const role of ["CUSTOMER", "ACCOUNTANT"] as Role[]) {
      session.role = role;
      for (const [name, read] of inventoryReads) {
        await expect(read(), `${name} as ${role}`).rejects.toThrow(/not allowed/);
      }
    }
  });

  it("purchasing reads allow OWNER and ADMIN only", async () => {
    for (const role of ["OWNER", "ADMIN"] as Role[]) {
      session.role = role;
      for (const [name, read] of purchasingReads) {
        await expect(read(), `${name} as ${role}`).resolves.toBeDefined();
      }
    }
  });

  it("purchasing reads refuse STAFF, CUSTOMER and ACCOUNTANT", async () => {
    for (const role of ["STAFF", "CUSTOMER", "ACCOUNTANT"] as Role[]) {
      session.role = role;
      for (const [name, read] of purchasingReads) {
        await expect(read(), `${name} as ${role}`).rejects.toThrow(/not allowed/);
      }
    }
  });
});
