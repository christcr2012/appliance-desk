import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { getOpenOutOfService, previewOutOfServiceCredit } from "@/domains/billing/out-of-service";
import { businessDateKey, formatBusinessDate } from "@/lib/business-date";
import { formatCents } from "@/domains/pricing/money";
import { Card, PageHeader } from "@/components/ui";
import { ResolveForms } from "./resolve-forms";

export const metadata = { title: "Out for repair", robots: { index: false, follow: false } };

export default async function OutOfServicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const period = await getOpenOutOfService(id);
  if (!period) notFound();
  const customer = period.agreement.customer.user.name ?? period.agreement.customer.user.email;
  const type = period.appliance.applianceType.name.toLowerCase();
  const preview = await previewOutOfServiceCredit(period.id, new Date());
  return (
    <div className="max-w-3xl">
      <PageHeader
        title={`${customer}'s ${type} is out for repair`}
        description={`${period.appliance.assetNumber} was taken on ${formatBusinessDate(period.startedOn)} with no replacement. The customer keeps paying the normal price and gets a credit on the next bill for each day without it.`}
      />
      <Card>
        <p className="text-sm text-ink">
          {preview.kind === "credit"
            ? `If a machine is back today, the credit is ${formatCents(preview.amountCents)} (${preview.days} ${preview.days === 1 ? "day" : "days"}). It grows each day until a machine is back.`
            : `No credit would be due today: ${preview.reason}.`}
        </p>
        <p className="mt-2 text-xs text-ink-faint">
          The day it was taken counts as a day without it; the day a machine arrives counts as a day with it. Per-day amount: the
          late-delivery setting in Settings → Pickups and deliveries. Never more than was billed.
        </p>
        <h2 className="mt-6 font-semibold text-ink">What happens next</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">
          <li>
            <Link href={`/desk/inventory/${period.appliance.id}`} className="font-semibold underline hover:text-primary">
              Schedule a replacement swap
            </Link>{" "}
            from the appliance page. When that visit delivers the replacement, the credit is worked out automatically.
          </li>
          <li>Or record below that the same machine was delivered back, or close this without a replacement.</li>
        </ul>
        <ResolveForms applianceId={period.appliance.id} startedOnKey={businessDateKey(period.startedOn)} todayKey={businessDateKey(new Date())} />
      </Card>
      <p className="mt-4 text-sm">
        <Link href={`/desk/agreements/${period.agreement.id}`} className="underline hover:text-primary">
          Open the rental ({period.rentalLine.label})
        </Link>
      </p>
    </div>
  );
}
