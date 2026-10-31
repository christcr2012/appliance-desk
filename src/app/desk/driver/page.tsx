import { getRouteForToday, type RouteStop } from "@/domains/jobs";
import { requireRole } from "@/lib/session";
import { EmptyState } from "@/components/ui";
import { ScreenHeader, Toaster } from "@/components/kit";
import { loadDriverMileage, loadDriverStopCounts } from "@/domains/vehicle/reads";
import { MileageCard } from "./mileage-card";
import { prisma } from "@/lib/prisma";
import { NoteAction } from "@/app/desk/collections/controls";
import { objectedAction } from "@/app/desk/collections/actions";
import { DriverJobCard } from "./driver-job-card";
import { OnMyWayText } from "./on-my-way-text";
import { RouteSnapshot } from "./route-snapshot-box";
import { buildRouteSnapshot } from "@/lib/route-snapshot";
import Link from "next/link";

export const metadata = { title: "My route" };

// AR-10b: the page guards itself. Layouts do not re-run on navigation
// (the PR #594 lesson), and this page also reads the vehicle mileage
// helpers and collection cases directly, which carry no guard of their
// own — so the role check lives here, at the same roles the layout
// admits (docs/DECISIONS.md, 2026-09-28 "Staff permissions framework").
//
// AR-5 section 5: this is now a personal route. getRouteForToday applies
// the person filter in the query (staff: own + unassigned when the setting
// allows; owner/admin: Mine by default, Everyone on ?who=everyone), so the
// page never renders a stop the server would refuse the person to work —
// in Everyone, another person's stop is shown with its actions disabled.
export default async function DriverViewPage({
  searchParams,
}: {
  searchParams: Promise<{ who?: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const actor = { userId: session.user.id, role: session.user.role };
  const isManager = actor.role === "OWNER" || actor.role === "ADMIN";
  const who = isManager && (await searchParams).who === "everyone" ? "everyone" : "mine";
  const jobs = await getRouteForToday({ actor, who });
  const mileage = await loadDriverMileage(new Date());
  const stopCounts = await loadDriverStopCounts(new Date());
  const objectable = jobs.length
    ? await prisma.collectionCase.findMany({
        where: { pickupJobId: { in: jobs.map((j) => j.id) }, objectedAt: null },
        select: { pickupJobId: true, agreementId: true },
      })
    : [];
  const objectionFor = new Map(objectable.map((c) => [c.pickupJobId, c.agreementId]));

  const canWork = (job: RouteStop) =>
    job.assignedToUserId === null || job.assignedToUserId === actor.userId;
  const mayText = (job: RouteStop) =>
    Boolean(job.customerId) && (isManager || job.assignedToUserId === actor.userId);

  const toggleClass = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-field px-4 py-2 text-sm font-bold ${
      active ? "bg-ink text-canvas" : "border border-line bg-white text-ink"
    }`;

  return (
    <div className="mx-auto max-w-md">
      <Toaster />
      <ScreenHeader title="My route" />
      <p className="-mt-2 pb-2 text-sm text-ink-soft">
        {jobs.length} stop{jobs.length === 1 ? "" : "s"} today
      </p>

      {isManager && (
        <nav aria-label="Whose route" className="mb-4 flex gap-2">
          <Link href="/desk/driver" className={toggleClass(who === "mine")} aria-current={who === "mine" ? "page" : undefined}>
            Mine
          </Link>
          <Link
            href="/desk/driver?who=everyone"
            className={toggleClass(who === "everyone")}
            aria-current={who === "everyone" ? "page" : undefined}
          >
            Everyone
          </Link>
        </nav>
      )}

      <MileageCard vehicles={mileage} stops={stopCounts} />

      {jobs.length === 0 ? (
        <EmptyState
          title="Nothing on your route today"
          description={
            isManager ? "See the board for the whole team's day." : "Scheduled visits will appear here in route order."
          }
        />
      ) : (
        <div className="space-y-4">
          {jobs.map((job, i) => (
            <div key={job.id} className="space-y-2">
              <DriverJobCard
                stopNumber={i + 1}
                job={{
                  id: job.id,
                  type: job.type,
                  status: job.status,
                  noShowAt: job.noShowAt,
                  scheduledAt: job.scheduledAt,
                  notes: job.notes,
                  customerName: job.customer?.user.name ?? null,
                  customerPhone: job.customer?.phone ?? null,
                  unitLabel: job.unitLabel,
                  accessNotes: job.accessNotes,
                  address: job.serviceAddress
                    ? {
                        line1: job.serviceAddress.line1,
                        line2: job.serviceAddress.line2,
                        city: job.serviceAddress.city,
                        state: job.serviceAddress.state,
                        zip: job.serviceAddress.zip,
                      }
                    : null,
                  appliances: job.appliances.map((item) => ({
                    id: item.appliance.id,
                    label: `${item.appliance.applianceType.name} #${item.appliance.assetNumber}`,
                  })),
                  canWork: canWork(job),
                  assignedToName: job.assignedTo?.name ?? null,
                }}
              />
              {mayText(job) && canWork(job) && (
                <OnMyWayText userId={actor.userId} jobId={job.id} customerId={job.customerId ?? undefined} />
              )}
              {objectionFor.get(job.id) && job.status !== "COMPLETED" && job.status !== "CANCELLED" && (
                <div className="rounded-lg border border-line bg-white p-3">
                  <p className="mb-2 text-sm">If the customer says no at the door, do not take the appliance.</p>
                  <NoteAction
                    label="Customer objected — end the visit"
                    noteLabel="What happened"
                    secondary
                    run={objectedAction.bind(null, objectionFor.get(job.id)!)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <RouteSnapshot snapshot={buildRouteSnapshot(actor.userId, jobs)} />
    </div>
  );
}
