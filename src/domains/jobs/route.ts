import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { businessDayBounds } from "@/lib/business-date";
import { getJobLocationPrivacy } from "@/domains/customers/location-contacts";
import { JOB_OPERATIONAL_SELECT } from "./index";

/**
 * AR-5 section 5: today's route for one person. Replaces getDriverJobsForToday,
 * which returned the whole team's day to everyone (spec section 1 fix 1).
 *
 * The person filter lives here, in the query, and mirrors the write-side scope
 * rules in scope.ts: STAFF see visits assigned to them, plus unassigned visits
 * while the staffMayWorkUnassignedJobs setting allows it (singleton settings
 * row, default true when unset — read exactly as scope.ts reads it).
 * OWNER/ADMIN default to the same "mine" view without the setting check and
 * may pass who: "everyone" for the whole team's day. A STAFF actor asking for
 * "everyone" still gets the staff filter — this function never widens.
 *
 * Visits with no time are never on a route (they wait on the Board), and a
 * customer pickup hand-over happens at our place, never at a stop.
 *
 * Unit label and access notes come only from getJobLocationPrivacy for the
 * same actor — never more than the visit page shows that person.
 */

export type RouteActor = { userId: string; role: string };
export type RouteWho = "mine" | "everyone";

type RouteJobRow = Prisma.JobGetPayload<{ select: typeof JOB_OPERATIONAL_SELECT }>;

export type RouteStop = RouteJobRow & {
  unitLabel: string | null;
  accessNotes: string | null;
};

export async function getRouteForToday(input: {
  actor: RouteActor;
  who?: RouteWho;
}): Promise<RouteStop[]> {
  const { actor } = input;
  if (actor.role !== "OWNER" && actor.role !== "ADMIN" && actor.role !== "STAFF") {
    throw new Error("Only the team can see a route.");
  }
  const who: RouteWho = input.who === "everyone" && actor.role !== "STAFF" ? "everyone" : "mine";

  let personFilter: Prisma.JobWhereInput | undefined;
  if (who === "mine") {
    let includeUnassigned = true;
    if (actor.role === "STAFF") {
      const settings = await prisma.businessSettings.findUnique({
        where: { id: "singleton" },
        select: { staffMayWorkUnassignedJobs: true },
      });
      includeUnassigned = settings?.staffMayWorkUnassignedJobs ?? true;
    }
    personFilter = {
      OR: [
        { assignedToUserId: actor.userId },
        ...(includeUnassigned ? [{ assignedToUserId: null }] : []),
      ],
    };
  }

  const { start, end } = businessDayBounds();
  const jobs = await prisma.job.findMany({
    where: {
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      scheduledAt: { gte: start, lt: end },
      customerPickupHandoff: false,
      ...personFilter,
    },
    select: JOB_OPERATIONAL_SELECT,
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
  });

  return Promise.all(
    jobs.map(async (job) => {
      const privacy = await getJobLocationPrivacy(
        { userId: actor.userId, role: actor.role },
        job.id,
      );
      return {
        ...job,
        unitLabel: privacy?.unitLabel ?? null,
        accessNotes: privacy?.accessNotes ?? null,
      };
    }),
  );
}
