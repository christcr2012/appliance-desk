import type { Prisma } from "@prisma/client";

import { getJurisdictionRentalTaxability } from "@/domains/tax/locations";
import { businessDateKey } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

/**
 * FEETAX-2 (spec: docs/build-specs/engines/FEE-TAXABILITY.md sections
 * 8-10). Before an address can be quoted, ordered or scheduled, every
 * taxing place confirmed for it must be set up: decided tax rules and,
 * where the place requires one, a city license on file in Business
 * records. The check is identical inside and outside the 50-mile
 * catalogue — a farther place simply has to be set up first — and
 * out-of-state addresses are refused outright.
 */

export type ReadinessProblemCode =
  | "OUT_OF_STATE"
  | "ADDRESS_NOT_LOCATED"
  | "PLACE_NOT_SET_UP"
  | "RULES_UNDECIDED"
  | "LICENSE_REQUIRED";

export type PlaceReadiness = {
  jurisdictionId: string;
  name: string;
  problem?: { code: ReadinessProblemCode; message: string };
};

export type DeliveryReadiness = {
  ready: boolean;
  /** True only when every problem is "rules not decided" — the one
   * problem an owner may override for a single order, with a reason. */
  overrideable: boolean;
  places: PlaceReadiness[];
};

type Db = Prisma.TransactionClient | typeof prisma;

const LICENSE_PROBLEM = (name: string) =>
  `${name} requires a city license before delivering there, and none is on file in Business records.`;

async function licenseOnFile(
  db: Db,
  recordId: string | null,
  now: Date,
): Promise<"ok" | "missing" | "expired"> {
  if (!recordId) return "missing";
  const record = await db.businessPaperwork.findUnique({
    where: { id: recordId },
    select: { status: true, expiresOn: true },
  });
  // Only a record marked done / in place counts as a license actually
  // held: a TO_DO or IN_PROGRESS record is a license not yet obtained,
  // and a NOT_NEEDED record is archived. Neither makes a place ready.
  if (!record || record.status !== "DONE") return "missing";
  if (record.expiresOn && businessDateKey(record.expiresOn) < businessDateKey(now)) {
    return "expired";
  }
  return "ok";
}

async function deliveryCounts(
  db: Db,
  jurisdictionId: string,
  now: Date,
  countDispatchedForJobId?: string,
): Promise<{ total: number; last12Months: number }> {
  const windowStart = new Date(now);
  windowStart.setMonth(windowStart.getMonth() - 12);
  const [total, last12Months] = await Promise.all([
    db.jurisdictionDeliveryCount.count({ where: { jurisdictionId } }),
    db.jurisdictionDeliveryCount.count({
      where: { jurisdictionId, deliveredOn: { gte: windowStart } },
    }),
  ]);
  if (!countDispatchedForJobId) return { total, last12Months };
  // Dispatch-time evaluation also counts deliveries already on the
  // truck for this place (other jobs IN_PROGRESS), so two orders booked
  // in advance can't both slip past a delivery-count license rule
  // before either one completes.
  const locatedHere = {
    isCurrent: true,
    status: "VERIFIED" as const,
    jurisdictions: { some: { jurisdictionId } },
  };
  const dispatched = await db.job.count({
    where: {
      // Completion counts DELIVERY and INSTALLATION jobs alike (both
      // put appliances in the home), so the in-flight count does too.
      type: { in: ["DELIVERY", "INSTALLATION"] },
      // ZONE-1: a customer pickup hand-over is not a delivery into the place.
      customerPickupHandoff: false,
      status: "IN_PROGRESS",
      id: { not: countDispatchedForJobId },
      OR: [
        { serviceAddress: { taxLocations: { some: locatedHere } } },
        {
          serviceAddressId: null,
          agreement: {
            serviceAddress: { taxLocations: { some: locatedHere } },
          },
        },
      ],
    },
  });
  return { total: total + dispatched, last12Months: last12Months + dispatched };
}

/**
 * Evaluate one taxing place on its own (no address): decided rules and
 * license state. Used by the address check, the Delivery area screen
 * and the To do attention list so every surface agrees.
 */
export async function evaluatePlaceReadiness(
  db: Db,
  jurisdiction: {
    id: string;
    name: string;
    level: string;
    administration: string;
  },
  now: Date,
  opts?: { countDispatchedForJobId?: string },
): Promise<PlaceReadiness> {
  const base = { jurisdictionId: jurisdiction.id, name: jurisdiction.name };
  const readiness = await db.jurisdictionReadiness.findUnique({
    where: { jurisdictionId: jurisdiction.id },
    select: {
      licenseRequired: true,
      licenseRecordId: true,
    },
  });

  // A "rules not decided" problem is collected, not returned at once:
  // the license check below runs independently, and a missing required
  // license (never overrideable) takes precedence over it. Returning
  // the undecided problem early would let an owner override past a
  // license the city requires.
  let rulesProblem: PlaceReadiness["problem"];
  if (jurisdiction.administration === "SELF_COLLECTED") {
    if (!readiness) {
      return {
        ...base,
        problem: {
          code: "PLACE_NOT_SET_UP",
          message: `${jurisdiction.name} isn't set up for deliveries yet.`,
        },
      };
    }
    // Whether the place taxes rentals is the TaxabilityRule RENTAL cell
    // for the jurisdiction — the one live rent decision, kept on Taxes >
    // What gets taxed. The readiness row never duplicates it.
    const rentalRule = await getJurisdictionRentalTaxability(
      db as Prisma.TransactionClient,
      jurisdiction.id,
      now,
    );
    if (rentalRule === null || rentalRule === "UNDECIDED") {
      rulesProblem = {
        code: "RULES_UNDECIDED",
        message: `The rental tax rule for ${jurisdiction.name} isn't decided yet.`,
      };
    } else if (readiness.licenseRequired === "UNKNOWN") {
      rulesProblem = {
        code: "RULES_UNDECIDED",
        message: `Whether ${jurisdiction.name} requires a city license isn't checked yet.`,
      };
    }
  }

  const licenseRequired = readiness?.licenseRequired ?? "NONE";
  if (licenseRequired === "ALWAYS" || licenseRequired === "AFTER_FIRST_DELIVERY" || licenseRequired === "AFTER_SECOND_DELIVERY_IN_12_MONTHS") {
    const onFile = await licenseOnFile(db, readiness?.licenseRecordId ?? null, now);
    if (licenseRequired === "ALWAYS") {
      if (onFile === "missing") {
        return { ...base, problem: { code: "LICENSE_REQUIRED", message: LICENSE_PROBLEM(jurisdiction.name) } };
      }
      if (onFile === "expired") {
        return {
          ...base,
          problem: {
            code: "LICENSE_REQUIRED",
            message: `The ${jurisdiction.name} license on file has expired.`,
          },
        };
      }
    } else if (onFile !== "ok") {
      const counts = await deliveryCounts(db, jurisdiction.id, now, opts?.countDispatchedForJobId);
      const crossed =
        licenseRequired === "AFTER_FIRST_DELIVERY"
          ? counts.total >= 1
          : counts.last12Months >= 1;
      if (crossed) {
        return {
          ...base,
          problem: {
            code: "LICENSE_REQUIRED",
            message:
              licenseRequired === "AFTER_FIRST_DELIVERY"
                ? `${jurisdiction.name} requires a city license after the first delivery there, and none is on file in Business records.`
                : `The next delivery to ${jurisdiction.name} needs a city license first — the city counts more than one delivery in 12 months as doing business there, and none is on file in Business records.`,
          },
        };
      }
    }
  }

  if (rulesProblem) return { ...base, problem: rulesProblem };
  return base;
}

/**
 * The spec's check: is this service address ready to deliver to?
 * Reads the address's current confirmed tax location; a location that
 * was never confirmed counts as not ready, never as ready.
 */
export async function deliveryTaxReadinessWith(
  db: Db,
  serviceAddressId: string,
  now = new Date(),
  opts?: { countDispatchedForJobId?: string },
): Promise<DeliveryReadiness> {
  const address = await db.serviceAddress.findUnique({
    where: { id: serviceAddressId },
    select: { id: true, state: true, city: true },
  });
  if (!address) throw new Error("Couldn't find that service address.");

  if (address.state !== "CO") {
    return {
      ready: false,
      overrideable: false,
      places: [
        {
          jurisdictionId: "",
          name: address.city,
          problem: {
            code: "OUT_OF_STATE",
            message: "Out-of-state delivery isn't set up.",
          },
        },
      ],
    };
  }

  const location = await db.addressTaxLocation.findFirst({
    where: { serviceAddressId, isCurrent: true },
    select: {
      status: true,
      jurisdictions: {
        select: {
          jurisdiction: {
            select: { id: true, name: true, level: true, administration: true },
          },
        },
        orderBy: { jurisdictionId: "asc" },
      },
    },
    orderBy: [{ lookedUpAt: "desc" }, { id: "desc" }],
  });

  if (!location || location.status !== "VERIFIED" || location.jurisdictions.length === 0) {
    return {
      ready: false,
      overrideable: false,
      places: [
        {
          jurisdictionId: "",
          name: address.city,
          problem: {
            code: "ADDRESS_NOT_LOCATED",
            message: "This address's tax places aren't confirmed yet.",
          },
        },
      ],
    };
  }

  const places: PlaceReadiness[] = [];
  for (const row of location.jurisdictions) {
    places.push(await evaluatePlaceReadiness(db, row.jurisdiction, now, opts));
  }
  const problems = places.filter((place) => place.problem);
  return {
    ready: problems.length === 0,
    overrideable:
      problems.length > 0 &&
      problems.every((place) => place.problem?.code === "RULES_UNDECIDED"),
    places,
  };
}

export async function deliveryTaxReadiness(
  serviceAddressId: string,
  now = new Date(),
): Promise<DeliveryReadiness> {
  return deliveryTaxReadinessWith(prisma, serviceAddressId, now);
}

/**
 * Gate for order saves and scheduling. An agreement carrying the
 * owner's override passes only when every problem is the overrideable
 * kind; a missing license, an out-of-state address or an unconfirmed
 * address can never be overridden (card acceptance 3).
 */
export async function assertDeliveryReadyInTx(
  tx: Prisma.TransactionClient,
  input: {
    serviceAddressId: string;
    agreementId?: string | null;
    countDispatchedForJobId?: string;
  },
  now = new Date(),
): Promise<void> {
  if (input.countDispatchedForJobId) {
    // Dispatch consumes a delivery-count slot, so two dispatches to the
    // same taxing place must not both read the counts before either
    // lands. Lock the place rows (in id order, so competing dispatches
    // queue instead of deadlocking) and hold them for the rest of the
    // caller's transaction; the count read below then sees any delivery
    // already on the truck.
    const location = await tx.addressTaxLocation.findFirst({
      where: { serviceAddressId: input.serviceAddressId, isCurrent: true },
      select: {
        jurisdictions: {
          select: { jurisdictionId: true },
          orderBy: { jurisdictionId: "asc" },
        },
      },
      orderBy: [{ lookedUpAt: "desc" }, { id: "desc" }],
    });
    const jurisdictionIds = [
      ...new Set((location?.jurisdictions ?? []).map((row) => row.jurisdictionId)),
    ].sort();
    for (const jurisdictionId of jurisdictionIds) {
      await tx.$queryRaw`SELECT "id" FROM "TaxJurisdiction" WHERE "id" = ${jurisdictionId} FOR UPDATE`;
    }
  }
  const readiness = await deliveryTaxReadinessWith(tx, input.serviceAddressId, now, {
    countDispatchedForJobId: input.countDispatchedForJobId,
  });
  if (readiness.ready) return;

  if (input.agreementId) {
    const agreement = await tx.rentalAgreement.findUnique({
      where: { id: input.agreementId },
      select: { readinessOverrideByUserId: true, readinessOverrideReason: true },
    });
    if (
      agreement?.readinessOverrideByUserId &&
      agreement.readinessOverrideReason &&
      readiness.overrideable
    ) {
      return;
    }
  }

  const first = readiness.places.find((place) => place.problem);
  throw new Error(first?.problem?.message ?? "That address isn't ready for delivery.");
}

/**
 * Record the owner's one-order override. Refuses unless the actor is
 * the OWNER, a reason is given, and every current problem is the
 * overrideable "rules not decided" kind. Audited.
 */
export async function recordReadinessOverrideInTx(
  tx: Prisma.TransactionClient,
  input: {
    agreementId: string;
    actorUserId: string;
    reason: string;
    serviceAddressId: string;
  },
  now = new Date(),
): Promise<void> {
  await assertActiveTeamActor(tx, input.actorUserId, ["OWNER"]);
  const reason = input.reason.trim();
  if (!reason) throw new Error("Say why this order may go ahead.");

  const readiness = await deliveryTaxReadinessWith(tx, input.serviceAddressId, now);
  if (readiness.ready) return;
  if (!readiness.overrideable) {
    const first = readiness.places.find((place) => place.problem);
    throw new Error(
      `This can't be overridden: ${first?.problem?.message ?? "the address isn't ready."}`,
    );
  }

  await tx.rentalAgreement.update({
    where: { id: input.agreementId },
    data: {
      readinessOverrideByUserId: input.actorUserId,
      readinessOverrideReason: reason.slice(0, 500),
      readinessOverrideAt: now,
    },
  });
  await tx.auditLog.create({
    data: {
      userId: input.actorUserId,
      action: "tax.delivery_readiness_override",
      entityType: "RentalAgreement",
      entityId: input.agreementId,
      newValue: {
        reason,
        problems: readiness.places.flatMap((place) =>
          place.problem ? [place.problem.message] : [],
        ),
      },
    },
  });
}

/**
 * Write the delivery count for a completed delivery order: one row,
 * for the address's city-level place. Idempotent by orderId, so a
 * retried completion never double-counts.
 */
export async function recordDeliveryCountInTx(
  tx: Prisma.TransactionClient,
  input: { orderId: string; serviceAddressId: string; deliveredOn: Date },
): Promise<void> {
  const location = await tx.addressTaxLocation.findFirst({
    where: { serviceAddressId: input.serviceAddressId, isCurrent: true },
    select: {
      jurisdictions: {
        select: { jurisdiction: { select: { id: true, level: true } } },
        orderBy: { jurisdictionId: "asc" },
      },
    },
    orderBy: [{ lookedUpAt: "desc" }, { id: "desc" }],
  });
  const city = location?.jurisdictions.find((row) => row.jurisdiction.level === "CITY");
  if (!city) return;
  await tx.jurisdictionDeliveryCount.createMany({
    data: [
      {
        jurisdictionId: city.jurisdiction.id,
        deliveredOn: input.deliveredOn,
        orderId: input.orderId,
      },
    ],
    skipDuplicates: true,
  });
}

export type DeliveryAreaPlace = {
  jurisdictionId: string;
  name: string;
  administration: string;
  /** The place-level verdict, or null when the place has no readiness row yet. */
  problem: string | null;
  reviewStatus: string;
  /** The TaxabilityRule RENTAL cell for the place ("UNDECIDED" when no
   * cell exists); null for state-collected places, which have no city
   * rent decision of their own. */
  taxesRentals: string | null;
  licenseRequired: string | null;
  filesThrough: string | null;
  sourceUrl: string | null;
  checkedOn: Date | null;
  notes: string | null;
  rateMilliPercent: number | null;
  deliveriesLast12Months: number;
  licenseRecord: { id: string; title: string; expiresOn: Date | null } | null;
};

/**
 * Taxes > Delivery area: every seeded place, plus any self-collected
 * place a confirmed address has landed in that has no row yet (the
 * beyond-50-miles path — it gets set up from this same screen).
 */
export async function listDeliveryAreaPlaces(
  now = new Date(),
  db: Db = prisma,
): Promise<DeliveryAreaPlace[]> {
  const rows = await db.jurisdictionReadiness.findMany({
    select: {
      jurisdictionId: true,
      licenseRequired: true,
      filesThrough: true,
      sourceUrl: true,
      checkedOn: true,
      reviewStatus: true,
      notes: true,
      jurisdiction: {
        select: {
          id: true,
          name: true,
          level: true,
          administration: true,
          rates: {
            where: { effectiveFrom: { lte: now } },
            orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
            take: 1,
            select: { rateMilliPercent: true },
          },
        },
      },
      licenseRecord: { select: { id: true, title: true, expiresOn: true } },
    },
    orderBy: [{ jurisdiction: { name: "asc" } }, { jurisdictionId: "asc" }],
  });

  const places: DeliveryAreaPlace[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    seen.add(row.jurisdictionId);
    const verdict = await evaluatePlaceReadiness(db, row.jurisdiction, now);
    const counts = await deliveryCounts(db, row.jurisdictionId, now);
    places.push({
      jurisdictionId: row.jurisdictionId,
      name: row.jurisdiction.name,
      administration: row.jurisdiction.administration,
      problem: verdict.problem?.message ?? null,
      reviewStatus: row.reviewStatus,
      taxesRentals:
        row.jurisdiction.administration === "SELF_COLLECTED"
          ? ((await getJurisdictionRentalTaxability(
              db as Prisma.TransactionClient,
              row.jurisdictionId,
              now,
            )) ?? "UNDECIDED")
          : null,
      licenseRequired: row.licenseRequired,
      filesThrough: row.filesThrough,
      sourceUrl: row.sourceUrl,
      checkedOn: row.checkedOn,
      notes: row.notes,
      rateMilliPercent: row.jurisdiction.rates[0]?.rateMilliPercent ?? null,
      deliveriesLast12Months: counts.last12Months,
      licenseRecord: row.licenseRecord
        ? {
            id: row.licenseRecord.id,
            title: row.licenseRecord.title,
            expiresOn: row.licenseRecord.expiresOn,
          }
        : null,
    });
  }

  const unseeded = await db.taxJurisdiction.findMany({
    where: {
      administration: "SELF_COLLECTED",
      readiness: null,
      addresses: {
        some: { location: { isCurrent: true, status: "VERIFIED" } },
      },
    },
    select: {
      id: true,
      name: true,
      level: true,
      administration: true,
      rates: {
        where: { effectiveFrom: { lte: now } },
        orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
        take: 1,
        select: { rateMilliPercent: true },
      },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  for (const jurisdiction of unseeded) {
    if (seen.has(jurisdiction.id)) continue;
    places.push({
      jurisdictionId: jurisdiction.id,
      name: jurisdiction.name,
      administration: jurisdiction.administration,
      problem: `${jurisdiction.name} isn't set up for deliveries yet.`,
      reviewStatus: "NEEDS_REVIEW",
      taxesRentals:
        ((await getJurisdictionRentalTaxability(
          db as Prisma.TransactionClient,
          jurisdiction.id,
          now,
        )) ?? "UNDECIDED"),
      licenseRequired: null,
      filesThrough: null,
      sourceUrl: null,
      checkedOn: null,
      notes: null,
      rateMilliPercent: jurisdiction.rates[0]?.rateMilliPercent ?? null,
      deliveriesLast12Months: 0,
      licenseRecord: null,
    });
  }

  return places.sort((a, b) => a.name.localeCompare(b.name));
}

/** Business records the owner can link as a place's city license. */
export async function listLicenseRecordOptions(db: Db = prisma) {
  return db.businessPaperwork.findMany({
    // Only licenses actually in place can be linked — the check counts
    // a linked record only when it is DONE (see licenseOnFile).
    where: { kind: "LICENSE", status: "DONE" },
    select: { id: true, title: true, expiresOn: true },
    orderBy: [{ title: "asc" }, { id: "asc" }],
    take: 100,
  });
}

/** Existing service addresses the "Check an address" box can run. */
export async function listCheckableAddresses(db: Db = prisma) {
  return db.serviceAddress.findMany({
    select: {
      id: true,
      line1: true,
      city: true,
      state: true,
      zip: true,
      customer: { select: { user: { select: { name: true, email: true } } } },
    },
    orderBy: [{ city: "asc" }, { line1: "asc" }, { id: "asc" }],
    take: 200,
  });
}

export type SaveReadinessInput = {
  licenseRequired:
    | "NONE"
    | "AFTER_FIRST_DELIVERY"
    | "AFTER_SECOND_DELIVERY_IN_12_MONTHS"
    | "ALWAYS"
    | "UNKNOWN";
  filesThrough: "SUTS" | "CITY_PORTAL" | "STATE_RETURN" | "UNKNOWN";
  licenseRecordId: string | null;
  sourceUrl: string | null;
  notes: string | null;
  markReviewed: boolean;
};

/**
 * Owner edit of one place's readiness (Taxes > Delivery area). Creates
 * the row for a place that has none. Every save is audited, and saving
 * stamps the check date — the values on the row are what the owner
 * just confirmed.
 */
export async function saveReadiness(
  actorUserId: string,
  jurisdictionId: string,
  input: SaveReadinessInput,
  now = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    // Writes lock the row first (AGENTS.md): the parent jurisdiction
    // is the stable lock target, including when no readiness row
    // exists yet for the upsert to lock.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "TaxJurisdiction" WHERE "id" = ${jurisdictionId} FOR UPDATE
    `;
    if (locked.length !== 1) throw new Error("Couldn't find that place.");
    if (input.licenseRecordId) {
      const record = await tx.businessPaperwork.findUnique({
        where: { id: input.licenseRecordId },
        select: { id: true },
      });
      if (!record) throw new Error("Choose a license record that exists.");
    }
    const data = {
      licenseRequired: input.licenseRequired,
      filesThrough: input.filesThrough,
      licenseRecordId: input.licenseRecordId,
      sourceUrl: input.sourceUrl,
      notes: input.notes,
      checkedOn: now,
      ...(input.markReviewed ? { reviewStatus: "REVIEWED" as const } : {}),
    };
    await tx.jurisdictionReadiness.upsert({
      where: { jurisdictionId },
      create: { jurisdictionId, ...data },
      update: data,
    });
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: "tax.readiness_update",
        entityType: "TaxJurisdiction",
        entityId: jurisdictionId,
        newValue: { ...data, checkedOn: now.toISOString() },
      },
    });
  });
}

export type DeliveryReadinessAttention = {
  jurisdictionId: string;
  name: string;
  problems: string[];
  sourceUrl: string | null;
  filesThrough: string;
  licenseRequired: string;
  reviewStatus: string;
  since: Date;
};

/**
 * Places that are blocking (or would block) a real, located address —
 * the source for the "Get ready to deliver in {city}" To do items.
 * Places nobody has tried to deliver to stay off Today; they are all
 * listed on Taxes > Delivery area instead.
 */
export async function listDeliveryReadinessAttention(
  now = new Date(),
  db: Db = prisma,
): Promise<DeliveryReadinessAttention[]> {
  const byPlace = new Map<string, DeliveryReadinessAttention>();
  const seenAddresses = new Set<string>();
  // A place's problems never depend on which of its addresses is
  // evaluated — delivery counts, the license rule and the rent rule are
  // all per place — so each place is evaluated once per call, however
  // many customer addresses it has.
  const placeCache = new Map<string, PlaceReadiness>();

  // Page through every verified location instead of capping the scan
  // itself: a capped scan silently dropped newer addresses' problems
  // once more than a page of addresses existed, so a place that needed
  // setup produced no To do item at all. The cap belongs on the items
  // this returns, which the caller applies.
  const PAGE = 50;
  for (let skip = 0; ; skip += PAGE) {
    const locations = await db.addressTaxLocation.findMany({
      where: { isCurrent: true, status: "VERIFIED", serviceAddressId: { not: null } },
      select: {
        serviceAddressId: true,
        lookedUpAt: true,
        jurisdictions: { select: { jurisdictionId: true } },
      },
      orderBy: [{ lookedUpAt: "asc" }, { id: "asc" }],
      skip,
      take: PAGE,
    });
    if (locations.length === 0) break;

    for (const location of locations) {
      if (!location.serviceAddressId || seenAddresses.has(location.serviceAddressId)) continue;
      seenAddresses.add(location.serviceAddressId);

      const jurisdictionIds = location.jurisdictions.map((row) => row.jurisdictionId);
      let places: PlaceReadiness[];
      if (jurisdictionIds.every((id) => placeCache.has(id))) {
        places = jurisdictionIds.map((id) => placeCache.get(id)!);
      } else {
        // The To do list is a reporting read over live data: an address
        // another part of the app deleted after the location lookup
        // above must not fail the whole list. Skip an address that is
        // confirmed gone; a read that fails for any other reason still
        // throws.
        let readiness: DeliveryReadiness;
        try {
          readiness = await deliveryTaxReadinessWith(db, location.serviceAddressId, now);
        } catch (error) {
          const stillThere = await db.serviceAddress.findUnique({
            where: { id: location.serviceAddressId },
            select: { id: true },
          });
          if (stillThere) throw error;
          continue;
        }
        places = readiness.places;
        for (const place of places) {
          if (place.jurisdictionId) placeCache.set(place.jurisdictionId, place);
        }
      }

      for (const place of places) {
        if (!place.problem || !place.jurisdictionId || byPlace.has(place.jurisdictionId)) {
          continue;
        }
        const row = await db.jurisdictionReadiness.findUnique({
          where: { jurisdictionId: place.jurisdictionId },
          select: { sourceUrl: true, filesThrough: true, licenseRequired: true, reviewStatus: true },
        });
        byPlace.set(place.jurisdictionId, {
          jurisdictionId: place.jurisdictionId,
          name: place.name,
          problems: [place.problem.message],
          sourceUrl: row?.sourceUrl ?? null,
          filesThrough: row?.filesThrough ?? "UNKNOWN",
          licenseRequired: row?.licenseRequired ?? "UNKNOWN",
          reviewStatus: row?.reviewStatus ?? "NEEDS_REVIEW",
          since: location.lookedUpAt,
        });
      }
    }
    if (locations.length < PAGE) break;
  }
  return [...byPlace.values()].sort((a, b) => a.since.getTime() - b.since.getTime());
}
