import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";

import {
  buildRouteSnapshot,
  deleteRouteSnapshotDatabase,
  readRouteSnapshot,
  saveRouteSnapshot,
  type RouteSnapshotData,
} from "@/lib/route-snapshot";
import { businessDateKey } from "@/lib/business-date";
import type { RouteStop } from "@/domains/jobs/route";

// AR-5 section 5: the on-device route copy. Pure storage behavior against
// fake-indexeddb (pinned 6.2.6 — the version current two weeks before the
// 2026-10-31 build date, per the spec).

const USER_A = "user-a";
const USER_B = "user-b";

function stopRow(): RouteStop {
  return {
    id: "job-1",
    type: "DELIVERY",
    status: "SCHEDULED",
    scheduledAt: new Date(),
    assignedToUserId: USER_A,
    durationMinutes: 45,
    version: 1,
    noShowAt: null,
    completedAt: null,
    createdAt: new Date(),
    notes: "Leave at the side door",
    completionNotes: null,
    checklist: [],
    customerId: "customer-1",
    serviceAddressId: "address-1",
    agreementId: null,
    customerPickupHandoff: false,
    customer: { phone: "9705550188", user: { name: "Route Customer", email: "route-customer@example.test" } },
    serviceAddress: {
      id: "address-1",
      line1: "1200 Route Way",
      line2: null,
      city: "Greeley",
      state: "CO",
      zip: "80631",
    },
    appliances: [
      {
        appliance: {
          id: "appliance-1",
          assetNumber: "W-1024",
          status: "RESERVED",
          applianceType: { name: "Washer" },
        },
      },
    ],
    assignedTo: { id: USER_A, name: "Staff A", email: "staff-a@example.test" },
    unitLabel: "Unit 4",
    accessNotes: "Gate code 4321",
  } as unknown as RouteStop;
}

function rawStored(): Promise<unknown> {
  return new Promise((resolve) => {
    const request = indexedDB.open("desk-route", 1);
    request.onsuccess = () => {
      const db = request.result;
      try {
        if (!db.objectStoreNames.contains("snapshot")) {
          db.close();
          return resolve(null);
        }
        const get = db.transaction("snapshot", "readonly").objectStore("snapshot").get("today");
        get.onsuccess = () => {
          db.close();
          resolve(get.result ?? null);
        };
        get.onerror = () => resolve(null);
      } catch {
        db.close();
        resolve(null);
      }
    };
    request.onerror = () => resolve(null);
  });
}

function rawPut(value: unknown): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.open("desk-route", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("snapshot");
    };
    request.onsuccess = () => {
      const db = request.result;
      const put = db.transaction("snapshot", "readwrite").objectStore("snapshot").put(value, "today");
      put.onsuccess = () => {
        db.close();
        resolve();
      };
      put.onerror = () => resolve();
    };
    request.onerror = () => resolve();
  });
}

describe("route snapshot (AR-5 section 5)", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it("builds the snapshot from exactly the screen fields", () => {
    const snapshot = buildRouteSnapshot(USER_A, [stopRow()]);
    expect(snapshot.v).toBe(1);
    expect(snapshot.userId).toBe(USER_A);
    expect(snapshot.dateKey).toBe(businessDateKey(new Date()));
    expect(snapshot.stops).toHaveLength(1);
    const stop = snapshot.stops[0];
    expect(stop.customerName).toBe("Route Customer");
    expect(stop.typeLabel).toBe("Delivery");
    expect(stop.statusLabel).toBe("Booked");
    expect(stop.unit).toBe("Unit 4");
    expect(stop.phone).toBe("9705550188");
    expect(stop.appliances).toEqual(["Washer #W-1024"]);
    expect(stop.addressLine).toBe("1200 Route Way, Greeley, CO 80631");
    expect(Object.keys(stop).sort()).toEqual(
      ["addressLine", "appliances", "customerName", "id", "notes", "phone", "statusLabel", "time", "typeLabel", "unit"].sort(),
    );
  });

  it("writes and reads back today's snapshot for the same person", async () => {
    const snapshot = buildRouteSnapshot(USER_A, [stopRow()]);
    await saveRouteSnapshot(snapshot);
    const read = await readRouteSnapshot(USER_A);
    expect(read?.userId).toBe(USER_A);
    expect(read?.stops[0]?.id).toBe("job-1");
  });

  it("the stored JSON never contains an email, a money amount, or access notes", async () => {
    await saveRouteSnapshot(buildRouteSnapshot(USER_A, [stopRow()]));
    const stored = JSON.stringify(await rawStored());
    expect(stored).not.toContain("@");
    expect(stored).not.toContain("$");
    expect(stored).not.toContain("accessNotes");
    expect(stored).not.toContain("Gate code");
    expect(stored).not.toContain("route-customer@example.test");
    expect(stored).not.toContain("staff-a@example.test");
  });

  it("refuses a snapshot from another day, and deletes it on read", async () => {
    const stale: RouteSnapshotData = {
      ...buildRouteSnapshot(USER_A, [stopRow()]),
      dateKey: "2020-01-01",
    };
    await rawPut(stale);
    expect(await readRouteSnapshot(USER_A)).toBeNull();
    expect(await rawStored()).toBeNull();
  });

  it("refuses another person's snapshot, and deletes it on read", async () => {
    await saveRouteSnapshot(buildRouteSnapshot(USER_A, [stopRow()]));
    expect(await readRouteSnapshot(USER_B)).toBeNull();
    expect(await rawStored()).toBeNull();
  });

  it("will not write a snapshot whose day is not today", async () => {
    const stale: RouteSnapshotData = {
      ...buildRouteSnapshot(USER_A, [stopRow()]),
      dateKey: "2020-01-01",
    };
    await saveRouteSnapshot(stale);
    expect(await rawStored()).toBeNull();
  });

  it("deleting the database (the sign-out cleanup) removes the copy", async () => {
    await saveRouteSnapshot(buildRouteSnapshot(USER_A, [stopRow()]));
    expect(await readRouteSnapshot(USER_A)).not.toBeNull();
    deleteRouteSnapshotDatabase();
    await expect.poll(async () => readRouteSnapshot(USER_A)).toBeNull();
  });
});
