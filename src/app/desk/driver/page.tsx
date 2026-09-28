import { getDriverJobsForToday } from "@/domains/jobs";
import { DriverJobCard } from "./driver-job-card";

export const metadata = { title: "Driver view" };

// No requireRole call needed here — the /desk layout already lets
// OWNER, ADMIN, and STAFF in (docs/DECISIONS.md, 2026-09-28 "Staff
// permissions framework"). This page shows no pricing or financials,
// so there's nothing further to restrict.
export default async function DriverViewPage() {
  const jobs = await getDriverJobsForToday();

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-xl font-semibold">Today&apos;s stops</h1>
      <p className="mt-1 text-sm text-gray-600">
        {jobs.length === 0
          ? "Nothing scheduled for today."
          : `${jobs.length} stop${jobs.length === 1 ? "" : "s"} today, in order.`}
      </p>

      <div className="mt-4 space-y-4">
        {jobs.map((job) => (
          <DriverJobCard
            key={job.id}
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
              appliances: job.appliances.map((a) => ({
                id: a.appliance.id,
                label: `${a.appliance.applianceType.name} — ${a.appliance.assetNumber}`,
              })),
            }}
          />
        ))}
      </div>
    </div>
  );
}
