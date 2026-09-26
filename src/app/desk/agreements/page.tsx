import Link from "next/link";
import { getAgreements } from "@/domains/agreements";
import { formatCents } from "@/domains/pricing";
import type { RentalAgreementStatus } from "@prisma/client";

export const metadata = { title: "Agreements" };

const STATUS_TABS: { value: RentalAgreementStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "AWAITING_SIGNATURE", label: "Awaiting signature" },
  { value: "ACTIVE", label: "Active" },
  { value: "ENDED", label: "Ended" },
  { value: "CANCELLED", label: "Cancelled" },
];

function isAgreementStatus(value: string | undefined): value is RentalAgreementStatus {
  return (
    value === "DRAFT" ||
    value === "AWAITING_SIGNATURE" ||
    value === "ACTIVE" ||
    value === "ENDED" ||
    value === "CANCELLED"
  );
}

export default async function AgreementsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: rawStatus } = await searchParams;
  const status = isAgreementStatus(rawStatus) ? rawStatus : undefined;

  const agreements = await getAgreements(status ? { status } : undefined);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Rental agreements</h1>
        <Link
          href="/desk/agreements/new"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          + New agreement
        </Link>
      </div>

      <nav aria-label="Filter agreements by status" className="mt-6 flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => {
          const active = (status ?? "ALL") === tab.value;
          return (
            <Link
              key={tab.value}
              href={tab.value === "ALL" ? "/desk/agreements" : `/desk/agreements?status=${tab.value}`}
              aria-current={active ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-sm ${
                active
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-300 text-gray-700 hover:border-gray-400"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {agreements.length === 0 ? (
        <p className="mt-6 text-sm text-gray-600">
          {status ? "No agreements with this status." : "No agreements yet."}
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {agreements.map((a) => (
            <li key={a.id}>
              <Link
                href={`/desk/agreements/${a.id}`}
                className="flex flex-col gap-1 px-4 py-4 hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-gray-900">
                    {a.customer.user.name ?? a.customer.user.email}
                  </p>
                  <p className="text-sm text-gray-600">
                    {a.serviceAddress.line1}, {a.serviceAddress.city}
                  </p>
                </div>
                <div className="text-sm text-gray-500 sm:text-right">
                  <p>{a.status}</p>
                  <p>
                    {a.lines.length > 0
                      ? `${formatCents(
                          a.lines.reduce((sum, l) => sum + l.monthlyPriceCents, 0),
                        )}/mo`
                      : "No appliances yet"}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
