import Link from "next/link";
import { agreementProgress } from "@/domains/agreements/progress";
import { SectionCard, secondaryActionClass } from "./workspace";
export function AgreementProgress({
  agreement,
}: {
  agreement: Parameters<typeof agreementProgress>[0];
}) {
  const data = agreementProgress(agreement);
  return (
    <SectionCard
      title="Agreement progress"
      description="Signature, delivery and billing are independent facts."
    >
      <p className="mb-4 text-sm font-medium text-ink">{data.next.label}</p>
      {data.next.href && (
        <Link className={secondaryActionClass} href={data.next.href}>
          Open next step
        </Link>
      )}
      {agreement.status === "DRAFT" && (
        <Link
          className={secondaryActionClass}
          href={`/desk/agreements/new?draftId=${agreement.id}`}
        >
          Resume rental builder
        </Link>
      )}
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.milestones.map((m) => (
          <div key={m.label}>
            <dt className="text-sm font-semibold text-ink">{m.label}</dt>
            <dd className="mt-1 text-sm text-ink-soft">{m.state}</dd>
          </div>
        ))}
      </dl>
    </SectionCard>
  );
}
