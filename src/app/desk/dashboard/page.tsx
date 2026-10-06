import Link from "next/link";
import { getDashboardStats } from "@/domains/dashboard";
import { formatCents } from "@/domains/pricing";
import { requireRole } from "@/lib/session";

export const metadata = { title: "Dashboard" };

function StatCard({
  label,
  value,
  href,
  tone = "default",
  warn,
}: {
  label: string;
  value: number | string;
  href?: string;
  tone?: "default" | "warning";
  /** Explicit override for whether the "warning" tone should actually
   * highlight — needed for a string value (e.g. a formatted dollar
   * amount) where "greater than zero" can't be inferred from the display
   * value alone the way it can for a plain number. Defaults to "value is
   * a positive number" when omitted, same behavior as before. */
  warn?: boolean;
}) {
  const shouldWarn = warn ?? (typeof value === "number" && value > 0);
  const body = (
    <div
      className={`rounded-lg border p-5 ${
        tone === "warning" && shouldWarn
          ? "border-amber-300 bg-amber-50"
          : "border-line bg-white"
      }`}
    >
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-ink">{value}</p>
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

// The layout already lets STAFF into /desk generally, but revenue/MRR
// figures shown here are OWNER/ADMIN only (docs/DECISIONS.md, 2026-09-28
// "Staff permissions framework") — never rely on the nav link being
// hidden alone.
export default async function DeskDashboardPage() {
  await requireRole("OWNER", "ADMIN");
  const stats = await getDashboardStats();

  return (
    <div>
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <p className="mt-1 text-sm text-ink-soft">
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
          label="Renewals starting later"
          value={stats.scheduledRenewalCount}
          href="/desk/agreements?status=SCHEDULED"
        />
        <StatCard
          label="Stale reservation holds"
          value={stats.staleReservationCount}
          href="/desk/agreements"
          tone="warning"
        />
        <StatCard
          label="Jobs scheduled"
          value={stats.upcomingJobCount}
          href="/desk/jobs?status=SCHEDULED"
        />
        <StatCard
          label="Open maintenance requests"
          value={stats.openMaintenanceRequestCount}
          href="/desk/maintenance"
          tone="warning"
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
        <StatCard
          label="Monthly recurring revenue"
          value={formatCents(stats.mrrCents)}
          href="/desk/revenue"
        />
        <StatCard
          label="Annualized recurring revenue"
          value={formatCents(stats.arrCents)}
          href="/desk/revenue"
        />
        <StatCard
          label="Past-due amount"
          value={formatCents(stats.pastDueCents)}
          href="/desk/revenue"
          tone="warning"
          warn={stats.pastDueCents > 0}
        />
        <StatCard
          label="Fleet utilization"
          value={`${Math.round(stats.averageUtilizationFraction * 100)}%`}
          href="/desk/fleet"
        />
      </div>

      {stats.totalAppliances === 0 && (
        <p className="mt-6 max-w-2xl text-sm text-ink-soft">
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
