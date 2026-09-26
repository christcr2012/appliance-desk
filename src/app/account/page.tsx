import Link from "next/link";
import { getServerSession } from "@/lib/session";
import { getPortalData } from "@/domains/portal";
import { formatCents } from "@/domains/pricing/money";

export default async function AccountHomePage() {
  const session = await getServerSession();
  const customer = session ? await getPortalData(session.user.id) : null;

  if (!customer) {
    return (
      <div>
        <h1 className="text-xl font-semibold">
          Welcome{session?.user?.name ? `, ${session.user.name}` : ""}
        </h1>
        <p className="mt-2 text-gray-600">
          There&apos;s no rental account attached to this login yet.
        </p>
      </div>
    );
  }

  const activeAgreements = customer.rentalAgreements.filter((a) => a.status === "ACTIVE");
  const upcomingJobs = customer.jobs.filter(
    (j) => j.status === "SCHEDULED" || j.status === "IN_PROGRESS",
  );
  const openRequests = customer.maintenanceRequests.filter(
    (r) => r.status !== "RESOLVED" && r.status !== "CLOSED",
  );

  return (
    <div>
      <h1 className="text-xl font-semibold">
        Welcome{session?.user?.name ? `, ${session.user.name}` : ""}
      </h1>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-sm text-gray-600">Active rentals</p>
          <p className="mt-1 text-3xl font-semibold text-gray-900">
            {activeAgreements.length}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-sm text-gray-600">Upcoming visits</p>
          <p className="mt-1 text-3xl font-semibold text-gray-900">{upcomingJobs.length}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-sm text-gray-600">Open maintenance requests</p>
          <p className="mt-1 text-3xl font-semibold text-gray-900">{openRequests.length}</p>
        </div>
      </div>

      {activeAgreements.length === 0 ? (
        <p className="mt-6 text-sm text-gray-600">
          You don&apos;t have an active rental yet.
        </p>
      ) : (
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="font-medium text-gray-900">Your rentals</h2>
          <ul className="mt-3 space-y-3">
            {activeAgreements.map((a) => {
              const total = a.lines.reduce((sum, l) => sum + l.monthlyPriceCents, 0);
              return (
                <li key={a.id} className="text-sm">
                  <p className="font-medium text-gray-900">
                    {a.serviceAddress.line1}, {a.serviceAddress.city}
                  </p>
                  <p className="text-gray-600">
                    {a.lines.map((l) => l.label).join(", ")} —{" "}
                    {formatCents(total)}/month
                  </p>
                </li>
              );
            })}
          </ul>
          <Link href="/account/rentals" className="mt-3 inline-block text-sm text-primary hover:underline">
            View all rental details →
          </Link>
        </div>
      )}

      <div className="mt-6">
        <Link
          href="/account/maintenance"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Report a problem or request maintenance
        </Link>
      </div>
    </div>
  );
}
