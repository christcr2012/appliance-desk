import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getOperationalApplianceById } from "@/domains/desk-access";
import { APPLIANCE_STATUS_LABELS } from "@/domains/inventory/lifecycle";

export async function OperationalAppliance({ id }: { id: string }) {
  const appliance = await getOperationalApplianceById(id);
  if (!appliance) notFound();
  return (
    <div className="max-w-2xl">
      <Link
        href="/desk/inventory"
        className="text-sm text-gray-600 hover:underline"
      >
        ← Back to inventory
      </Link>
      <h1 className="mt-2 text-xl font-semibold">
        {appliance.assetNumber} — {appliance.applianceType.name}
      </h1>
      <p className="mt-2">{APPLIANCE_STATUS_LABELS[appliance.status]}</p>
      <dl className="mt-4 space-y-2">
        {Object.entries({
          Manufacturer: appliance.manufacturer,
          Model: appliance.model,
          "Serial number": appliance.serialNumber,
          Color: appliance.color,
          Condition: appliance.condition,
          Location: appliance.currentLocation,
          Notes: appliance.notes,
        })
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label}>
              <dt className="font-medium">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      <Link
        href={`/desk/inventory/${id}/qr`}
        className="mt-4 inline-block text-primary hover:underline"
      >
        Print QR label
      </Link>
      <section className="mt-6">
        <h2 className="font-medium">Condition photos</h2>
        {appliance.photos.length === 0 ? (
          <p>No photos recorded.</p>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-3">
            {appliance.photos.map((photo) => (
              <Image
                key={photo.id}
                src={photo.url}
                alt={photo.altText ?? "Condition photo"}
                width={300}
                height={240}
                className="h-auto w-full rounded-lg"
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
