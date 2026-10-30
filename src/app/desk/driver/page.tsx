import { getDriverJobsForToday } from "@/domains/jobs";
import { requireRole } from "@/lib/session";
import { EmptyState } from "@/components/ui";
import { ScreenHeader } from "@/components/kit";
import { loadDriverMileage, loadDriverStopCounts } from "@/domains/vehicle/reads";
import { MileageCard } from "./mileage-card";
import { prisma } from "@/lib/prisma";
import { NoteAction } from "@/app/desk/collections/controls";
import { objectedAction } from "@/app/desk/collections/actions";
import { DriverJobCard } from "./driver-job-card";

export const metadata = { title: "Driver view" };

// AR-10b: the page guards itself. Layouts do not re-run on navigation
// (the PR #594 lesson), and this page also reads the vehicle mileage
// helpers and collection cases directly, which carry no guard of their
// own — so the role check lives here, at the same roles the layout
// admits (docs/DECISIONS.md, 2026-09-28 "Staff permissions framework").
export default async function DriverViewPage() {
  await requireRole("OWNER", "ADMIN", "STAFF");
  const jobs = await getDriverJobsForToday();
  const mileage = await loadDriverMileage(new Date());
  const stopCounts = await loadDriverStopCounts(new Date());
  const objectable = jobs.length ? await prisma.collectionCase.findMany({ where: { pickupJobId: { in: jobs.map((j) => j.id) }, objectedAt: null }, select: { pickupJobId: true, agreementId: true } }) : [];
  const objectionFor = new Map(objectable.map((c) => [c.pickupJobId, c.agreementId]));

  return (
    <div className="mx-auto max-w-md">
      <ScreenHeader title="Shared team route" />
      <p className="-mt-2 pb-2 text-sm text-ink-soft">All scheduled visits for the team today.</p>

      <MileageCard vehicles={mileage} stops={stopCounts} />

      {jobs.length === 0 ? (
        <EmptyState
          title="Nothing scheduled for today"
          description="Scheduled visits will appear here in route order."
        />
      ) : (
        <>
          <p className="mb-4 text-sm text-ink-soft">
            {jobs.length} stop{jobs.length === 1 ? "" : "s"} today, in order.
          </p>
          <div className="space-y-4">
            {jobs.map((job) => (
              <div key={job.id} className="space-y-2">
              <DriverJobCard
                job={{
                  id: job.id,
                  type: job.type,
                  status: job.status,
                  scheduledAt: job.scheduledAt,
                  notes: job.notes,
                  customerName: job.customer?.user.name ?? null,
                  customerPhone: job.customer?.phone ?? null,
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
                    label: `${item.appliance.applianceType.name} — ${item.appliance.assetNumber}`,
                  })),
                }}
              />
              {objectionFor.get(job.id) && job.status !== "COMPLETED" && job.status !== "CANCELLED" && (
                <div className="rounded-lg border border-line bg-white p-3"><p className="mb-2 text-sm">If the customer says no at the door, do not take the appliance.</p>
                  <NoteAction label="Customer objected — end the visit" noteLabel="What happened" secondary run={objectedAction.bind(null, objectionFor.get(job.id)!)} /></div>
              )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
