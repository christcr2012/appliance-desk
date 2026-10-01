import { AgreementProgress } from "@/components/desk/agreement-progress";
import { requireRole } from "@/lib/session";
import { notFound } from "next/navigation";
import { OperationalAgreement } from "./operational-agreement";
import Link from "next/link";
import { getAgreementById } from "@/domains/agreements";
import { getAppliances } from "@/domains/inventory";
import { AgreementDetailPanel } from "./agreement-detail-panel";

export const metadata = { title: "Agreement" };

export default async function AgreementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const { id } = await params;
  if (session.user.role === "STAFF") return <OperationalAgreement id={id} />;
  const [agreement, availableAppliances] = await Promise.all([
    getAgreementById(id),
    getAppliances({ status: "AVAILABLE" }),
  ]);

  if (!agreement) {
    notFound();
  }

  return (
    <div className="max-w-3xl">
      <Link
        href="/desk/agreements"
        className="text-sm text-gray-600 hover:underline"
      >
        &larr; Back to agreements
      </Link>

      <h1 className="mt-2 text-xl font-semibold">
        Agreement for{" "}
        <Link
          href={`/desk/customers/${agreement.customer.id}`}
          className="hover:underline"
        >
          {agreement.customer.user.name ?? agreement.customer.user.email}
        </Link>
      </h1>
      <p className="mt-1 text-sm text-gray-600">
        {agreement.serviceAddress.line1}, {agreement.serviceAddress.city},{" "}
        {agreement.serviceAddress.state} {agreement.serviceAddress.zip}
      </p>

      <div className="mt-6">
        <AgreementProgress agreement={agreement} />
      </div>
      <div className="mt-6">
        <AgreementDetailPanel
          agreement={agreement}
          availableAppliances={availableAppliances.map((a) => ({
            id: a.id,
            assetNumber: a.assetNumber,
            typeName: a.applianceType.name,
          }))}
        />
      </div>
    </div>
  );
}
