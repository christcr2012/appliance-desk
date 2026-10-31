import { businessDateKey, formatBusinessTime } from "@/lib/business-date";
import { jobTypeLabel } from "@/lib/status-labels";
import { visitPill } from "@/domains/jobs/words";
import type { RouteStop } from "@/domains/jobs/route";

/**
 * AR-5 section 5: the on-device copy of today's route.
 *
 * The shape below is an allowlist, built field by field from what the My
 * route screen itself renders — nothing else can ride along: no money, no
 * email addresses, and no access notes (they can contain door codes, so they
 * stay online-only). Stored in IndexedDB database "desk-route", store
 * "snapshot", key "today", partitioned by the signed-in user and the Denver
 * calendar day: a snapshot is only ever read back for the same person on the
 * same day, and sign-out deletes the whole database (kit profile menu).
 * Every storage touch is wrapped so a browser that refuses IndexedDB
 * (private mode) simply keeps the plain offline page.
 */

export type RouteSnapshotStop = {
  id: string;
  time: string;
  typeLabel: string;
  statusLabel: string;
  customerName: string;
  addressLine: string | null;
  phone: string | null;
  unit: string | null;
  appliances: string[];
  notes: string | null;
};

export type RouteSnapshotData = {
  v: 1;
  userId: string;
  dateKey: string;
  savedAt: string;
  stops: RouteSnapshotStop[];
};

export function buildRouteSnapshot(userId: string, stops: RouteStop[], now: Date = new Date()): RouteSnapshotData {
  return {
    v: 1,
    userId,
    dateKey: businessDateKey(now),
    savedAt: now.toISOString(),
    stops: stops.map((stop) => ({
      id: stop.id,
      time: stop.scheduledAt ? formatBusinessTime(stop.scheduledAt) : "No time set",
      typeLabel: jobTypeLabel(stop.type),
      statusLabel: visitPill(stop).label,
      customerName: stop.customer?.user.name ?? "No customer",
      addressLine: stop.serviceAddress
        ? `${stop.serviceAddress.line1}, ${stop.serviceAddress.city}, ${stop.serviceAddress.state} ${stop.serviceAddress.zip}`
        : null,
      phone: stop.customer?.phone ?? null,
      unit: stop.unitLabel,
      appliances: stop.appliances.map(
        (item) => `${item.appliance.applianceType.name} #${item.appliance.assetNumber}`,
      ),
      notes: stop.notes,
    })),
  };
}

const DB_NAME = "desk-route";
const STORE_NAME = "snapshot";
const KEY = "today";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction(STORE_NAME, mode);
    const result = await requestToPromise(run(tx.objectStore(STORE_NAME)));
    db.close();
    return result;
  } catch {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    return null;
  }
}

/** Write today's snapshot. A stale record (another day) is replaced outright. */
export async function saveRouteSnapshot(snapshot: RouteSnapshotData): Promise<void> {
  try {
    if (snapshot.dateKey !== businessDateKey(new Date())) return;
    await withStore("readwrite", (store) => store.put(snapshot, KEY));
  } catch {
    /* storage denied: the offline copy is best-effort */
  }
}

/**
 * Read the saved route for this person, today only. A record from another
 * day or another user is deleted on sight and never returned.
 */
export async function readRouteSnapshot(userId: string): Promise<RouteSnapshotData | null> {
  try {
    const raw = await withStore<RouteSnapshotData>("readonly", (store) => store.get(KEY));
    if (!raw || raw.v !== 1) return null;
    if (raw.userId !== userId || raw.dateKey !== businessDateKey(new Date())) {
      await withStore("readwrite", (store) => store.delete(KEY));
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

/** Sign-out cleanup for surfaces that do not already delete the database. */
export function deleteRouteSnapshotDatabase(): void {
  try {
    if (typeof indexedDB !== "undefined") indexedDB.deleteDatabase(DB_NAME);
  } catch {
    /* storage denied */
  }
}
