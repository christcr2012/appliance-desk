import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { getOperationalApplianceById } from "@/domains/desk-access";
import { PrintButton } from "./print-button";

export const metadata = { title: "QR label" };

/** A printable label for one physical appliance — the QR code points at
 * /scan/[assetNumber], which sends whoever scans it somewhere different
 * depending on who they are (see that page's own doc comment): staff
 * straight to this unit's inventory page, the customer currently renting
 * it to a pre-filled service request, anyone else to a safe generic page.
 * Server-rendered SVG (the `qrcode` package, no client JS, no external
 * service call) so this works the same in CI/preview/production without
 * a network dependency. */
export default async function ApplianceQrLabelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const appliance = await getOperationalApplianceById(id);

  if (!appliance) {
    notFound();
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const scanUrl = `${appUrl}/scan/${encodeURIComponent(appliance.assetNumber)}`;
  const svg = await QRCode.toString(scanUrl, {
    type: "svg",
    margin: 1,
    width: 240,
  });

  return (
    <div className="mx-auto max-w-sm">
      <div className="print:hidden">
        <p className="text-sm text-gray-600">
          Print this and attach it to the physical appliance. Scanning it
          opens the right page automatically for whoever scans it.
        </p>
        <PrintButton />
      </div>

      <div className="mt-6 flex flex-col items-center gap-2 rounded-lg border border-gray-200 bg-white p-6 text-center print:border-0">
        <div
          className="[&>svg]:h-auto [&>svg]:w-48"
          // Our own server-generated SVG (qrcode package) — not user input.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <p className="mt-2 font-medium text-gray-900">{appliance.assetNumber}</p>
        <p className="text-sm text-gray-600">{appliance.applianceType.name}</p>
      </div>
    </div>
  );
}

