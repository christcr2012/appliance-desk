import Link from "next/link";
import { notFound } from "next/navigation";
import { getOperationalAgreementById } from "@/domains/desk-access";

export async function OperationalAgreement({ id }: { id: string }) {
  const agreement = await getOperationalAgreementById(id);
  if (!agreement) notFound();
  return (
    <div className="max-w-3xl">
      <Link
        href="/desk/agreements"
        className="text-sm text-ink-soft hover:underline"
      >
        ← Back to agreements
      </Link>
      <h1 className="mt-2 text-xl font-semibold">
        Rental for{" "}
        {agreement.customer.user.name ?? agreement.customer.user.email}
      </h1>
      <p className="mt-2">{agreement.status}</p>
      <p className="mt-2">
        {agreement.serviceAddress.line1}, {agreement.serviceAddress.city},{" "}
        {agreement.serviceAddress.state} {agreement.serviceAddress.zip}
      </p>
      <section className="mt-6">
        <h2 className="font-medium">Appliances</h2>
        {agreement.lines.length === 0 ? (
          <p>No appliances yet.</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {agreement.lines.map((line) => (
              <li key={line.id}>
                {line.assignments.length === 0
                  ? "Unassigned appliance line"
                  : line.assignments.map(({ appliance }) => (
                      <Link
                        key={appliance.id}
                        href={`/desk/inventory/${appliance.id}`}
                        className="mr-2 text-primary hover:underline"
                      >
                        {appliance.applianceType.name} — {appliance.assetNumber}
                      </Link>
                    ))}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
