import { notFound } from "next/navigation";
import Link from "next/link";
import { getMaintenanceRequestById } from "@/domains/maintenance";
import { MaintenanceDetailPanel } from "./maintenance-detail-panel";

export const metadata = { title: "Maintenance request" };

export default async function MaintenanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const request = await getMaintenanceRequestById(id);

  if (!request) {
    notFound();
  }

  return (
    <div className="max-w-2xl">
      <Link href="/desk/maintenance" className="text-sm text-gray-600 hover:underline">
        &larr; Back to maintenance requests
      </Link>

      <h1 className="mt-2 text-xl font-semibold">
        {request.customer.user.name ?? request.customer.user.email}
      </h1>
      <p className="mt-1 text-sm text-gray-600">
        {request.appliance
          ? `${request.appliance.applianceType.name} (${request.appliance.assetNumber})`
          : "General request"}{" "}
        · Priority: {request.priority} · Submitted{" "}
        {new Date(request.openedAt).toLocaleString()}
      </p>

      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-5">
        <p className="text-sm text-gray-700">{request.problem}</p>
      </div>

      {request.photos.length > 0 && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="font-medium text-gray-900">
            Photo{request.photos.length > 1 ? "s" : ""} from the customer
          </h2>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {request.photos.map((p) => (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt={p.altText ?? "Photo of the problem from the customer"}
                  className="h-32 w-full rounded-lg object-cover"
                />
              </a>
            ))}
          </div>
        </div>
      )}

      {request.jobs.length > 0 && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="font-medium text-gray-900">Jobs scheduled for this</h2>
          <ul className="mt-2 divide-y divide-gray-200">
            {request.jobs.map((j) => (
              <li key={j.id} className="py-2 text-sm">
                <Link href={`/desk/jobs/${j.id}`} className="text-primary hover:underline">
                  {j.type} — {j.status}
                </Link>
                {j.scheduledAt && ` · ${new Date(j.scheduledAt).toLocaleString()}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6">
        <MaintenanceDetailPanel request={request} />
      </div>
    </div>
  );
}
