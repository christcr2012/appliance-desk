import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { splitPlanFor } from "@/domains/packages/split";
import { Card, PageHeader } from "@/components/ui";
import { SplitForm } from "./split-form";

export const metadata = { title: "Split an old set record", robots: { index: false, follow: false } };

export default async function SplitOldSetPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const plan = await splitPlanFor(id);
  if (!plan) notFound();
  const { appliance } = plan;
  return (
    <div className="max-w-3xl">
      <PageHeader
        title={`Split ${appliance.assetNumber} into separate machines`}
        description={`A ${plan.packageName} is now a set of separate machines, each with its own model, serial number and history. This record becomes the first machine and keeps everything recorded so far; the others are added with new asset numbers.`}
      />
      <Card>
        <ul className="mb-4 space-y-1 text-sm text-ink-soft">
          <li>Status stays: {appliance.status.toLowerCase().replaceAll("_", " ")}.</li>
          <li>If it is on a rental, the new machine joins the same rental. The signed price and wording do not change.</li>
          <li>Any cost and seller tax already recorded are split evenly between the machines, so totals stay the same.</li>
        </ul>
        <SplitForm
          applianceId={appliance.id}
          assetNumber={appliance.assetNumber}
          parts={plan.parts}
          current={{ manufacturer: appliance.manufacturer ?? "", model: appliance.model ?? "", serialNumber: appliance.serialNumber ?? "" }}
        />
      </Card>
      <p className="mt-4 text-sm">
        <Link href={`/desk/inventory/${appliance.id}`} className="underline hover:text-primary">
          Back to {appliance.assetNumber}
        </Link>
      </p>
    </div>
  );
}
