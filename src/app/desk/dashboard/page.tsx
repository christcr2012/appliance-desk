import Link from "next/link";
import { getDashboardStats } from "@/domains/dashboard";

export const metadata = { title: "Dashboard" };

function StatCard({
  label,
  value,
  href,
  tone = "default",
}: {
  label: string;
  value: number;
  href?: string;
  tone?: "default" | "warning";
}) {
  const body = (
    <div
      className={`rounded-lg border p-5 ${
        tone === "warning" && value > 0
          ? "border-amber-300 bg-amber-50"
          : "border-gray-200 bg-white"
      }`}
    >
      <p className="text-sm text-gray-600">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-gray-900">{value}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}

export default async function DeskDashboardPage() {
  const stats = await getDashboardStats();

  return (
    <div>
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <p className="mt-1 text-sm text-gray-600">
        A quick look at what needs your attention right now.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="New leads needing attention"
          value={stats.newLeadCount}
          href="/desk/leads?status=NEW"
          tone="warning"
        />
        <StatCard
          label="High-value new leads"
          value={stats.highValueNewLeadCount}
          href="/desk/leads?status=NEW"
          tone="warning"
        />
        <StatCard
          label="Leads you've contacted"
          value={stats.contactedLeadCount}
          href="/desk/leads?status=CONTACTED"
        />
        <StatCard
          label="Leads converted to customers"
          value={stats.convertedLeadCount}
          href="/desk/leads?status=CONVERTED"
        />
        <StatCard label="Total customers" value={stats.totalCustomers} />
        <StatCard
          label="Draft agreements"
          value={stats.draftAgreementCount}
          href="/desk/agreements?status=DRAFT"
        />
        <StatCard
          label="Awaiting signature"
          value={stats.awaitingSignatureCount}
          href="/desk/agreements?status=AWAITING_SIGNATURE"
          tone="warning"
        />
        <StatCard
          label="Active agreements"
          value={stats.activeAgreementCount}
          href="/desk/agreements?status=ACTIVE"
        />
        <StatCard
          label="Jobs scheduled"
          value={stats.upcomingJobCount}
          href="/desk/jobs?status=SCHEDULED"
        />
        <StatCard
          label="Total appliances"
          value={stats.totalAppliances}
          href="/desk/inventory"
        />
        <StatCard
          label="Appliances available"
          value={stats.applianceStatusCounts.AVAILABLE}
          href="/desk/inventory?status=AVAILABLE"
        />
        <StatCard
          label="Appliances rented out"
          value={stats.applianceStatusCounts.RENTED}
          href="/desk/inventory?status=RENTED"
        />
      </div>

      {stats.totalAppliances === 0 && (
        <p className="mt-6 max-w-2xl text-sm text-gray-600">
          You don&apos;t have any individual appliance units tracked yet —
          add your first one from{" "}
          <Link href="/desk/inventory" className="underline">
            Inventory
          </Link>{" "}
          as you obtain it.
        </p>
      )}
    </div>
  );
}
