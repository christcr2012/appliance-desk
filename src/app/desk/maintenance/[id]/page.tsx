import { ContextCommunicationPanel } from "@/components/desk/context-communication-panel";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { requireRole } from "@/lib/session";
import { getMaintenanceRequestById } from "@/domains/maintenance";
import { MaintenanceDetailPanel } from "./maintenance-detail-panel";
import { privatePhotoReadPath } from "@/lib/photo-storage";

export const metadata = { title: "Maintenance request" };

export default async function MaintenanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const canScheduleJobs =
    session.user.role === "OWNER" || session.user.role === "ADMIN";
  const { id } = await params;
  const request = await getMaintenanceRequestById(id);

  if (!request) {
    notFound();
  }

  return (
    <div className="max-w-2xl">
      <Link
        href="/desk/maintenance"
        className="text-sm text-ink-soft hover:underline"
      >
        &larr; Back to maintenance requests
      </Link>

      <h1 className="mt-2 text-xl font-semibold">
        {request.customer.user.name ?? request.customer.user.email}
      </h1>
      <p className="mt-1 text-sm text-ink-soft">
        {request.appliance
          ? `${request.appliance.applianceType.name} (${request.appliance.assetNumber})`
          : "General request"}{" "}
        · Priority: {request.priority} · Submitted{" "}
        {new Date(request.openedAt).toLocaleString()}
      </p>

      <div className="mt-4 rounded-lg border border-line bg-white p-5">
        <p className="text-sm text-ink-soft">{request.problem}</p>
      </div>

      {request.photos.length > 0 && (
        <div className="mt-4 rounded-lg border border-line bg-white p-5">
          <h2 className="font-medium text-ink">
            Photo{request.photos.length > 1 ? "s" : ""} from the customer
          </h2>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {request.photos.map((p) => {
              const readUrl = privatePhotoReadPath(p.id);
              return (
                <a
                  key={p.id}
                  href={readUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="relative block h-32 w-full overflow-hidden rounded-lg"
                >
                  <Image
                    src={readUrl}
                    alt={p.altText ?? "Photo of the problem from the customer"}
                    fill
                    sizes="(min-width: 640px) 33vw, 45vw"
                    className="object-cover"
                  />
                </a>
              );
            })}
          </div>
        </div>
      )}

      {request.jobs.length > 0 && (
        <div className="mt-4 rounded-lg border border-line bg-white p-5">
          <h2 className="font-medium text-ink">Jobs scheduled for this</h2>
          <ul className="mt-2 divide-y divide-line">
            {request.jobs.map((j) => (
              <li key={j.id} className="py-2 text-sm">
                <Link
                  href={`/desk/jobs/${j.id}`}
                  className="text-primary hover:underline"
                >
                  {j.type} — {j.status}
                </Link>
                {j.scheduledAt &&
                  ` · ${new Date(j.scheduledAt).toLocaleString()}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6">
        <MaintenanceDetailPanel
          request={request}
          canScheduleJobs={canScheduleJobs}
        />
      </div>
      {canScheduleJobs && <ContextCommunicationPanel kind="MaintenanceRequest" id={request.id} />}
    </div>
  );
}
