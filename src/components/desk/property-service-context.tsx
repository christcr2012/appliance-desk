import Link from "next/link";
import { SectionCard } from "./workspace";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";

type Property = { id: string; line1: string; city: string };
type Visit = {
  id: string;
  serviceAddressId: string | null;
  scheduledAt: Date | null;
  type: string;
  status: string;
};
type Request = {
  id: string;
  problem: string;
  status: string;
  jobs: { serviceAddressId: string | null }[];
};

/** Property context from explicit job addresses, not guessed request ownership. */
export function PropertyServiceContext({
  addresses,
  jobs,
  requests,
}: {
  addresses: Property[];
  jobs: Visit[];
  requests: Request[];
}) {
  const known = new Set(addresses.map((a) => a.id));
  const addressIds = (request: Request) =>
    new Set(
      request.jobs
        .map((j) => j.serviceAddressId)
        .filter((id): id is string => id !== null && known.has(id)),
    );
  const unlocated = requests.filter((r) => addressIds(r).size === 0);
  return (
    <SectionCard
      title="Visits and service by property"
      description="Request locations come from recorded visits. Requests without one stay visible below; an appliance assignment does not establish the request location."
    >
      {addresses.map((address) => {
        const visits = jobs.filter((j) => j.serviceAddressId === address.id);
        const service = requests.filter((r) => addressIds(r).has(address.id));
        return (
          <section
            key={address.id}
            className="border-b border-line py-4 last:border-0"
          >
            <h3 className="font-semibold break-words">
              {address.line1}, {address.city}
            </h3>
            {visits.length === 0 && service.length === 0 ? (
              <p className="mt-2 text-sm text-ink-soft">
                No open visits or requests linked here.
              </p>
            ) : null}
            <ul className="mt-2 space-y-2 text-sm">
              {visits.map((job) => (
                <li key={job.id}>
                  <Link className="underline" href={`/desk/jobs/${job.id}`}>
                    {job.type.replaceAll("_", " ")} —{" "}
                    {job.status.replaceAll("_", " ")}
                  </Link>
                  <p className="text-ink-soft">
                    {job.scheduledAt
                      ? `${formatBusinessDate(job.scheduledAt)} · ${formatBusinessTime(job.scheduledAt)}`
                      : "Not scheduled"}
                  </p>
                </li>
              ))}
              {service.map((request) => (
                <li key={request.id}>
                  <Link
                    className="underline break-words"
                    href={`/desk/maintenance/${request.id}`}
                  >
                    {request.status.replaceAll("_", " ")} request —{" "}
                    {request.problem}
                  </Link>
                  {addressIds(request).size > 1 ? (
                    <p className="text-ink-soft">
                      Recorded visits link this request to more than one
                      property.
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {unlocated.length > 0 ? (
        <section className="mt-4">
          <h3 className="font-semibold">
            Requests without a recorded property
          </h3>
          <ul className="mt-2 space-y-2 text-sm">
            {unlocated.map((request) => (
              <li key={request.id}>
                <Link
                  className="underline break-words"
                  href={`/desk/maintenance/${request.id}`}
                >
                  {request.status.replaceAll("_", " ")} request —{" "}
                  {request.problem}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {addresses.length === 0 && requests.length === 0 ? (
        <p className="text-sm text-ink-soft">
          No property service context yet.
        </p>
      ) : null}
    </SectionCard>
  );
}
