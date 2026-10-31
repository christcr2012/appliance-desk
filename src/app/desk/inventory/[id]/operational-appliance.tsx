import Image from "next/image";
import { notFound } from "next/navigation";
import { getOperationalApplianceById } from "@/domains/desk-access";
import { privatePhotoReadPath } from "@/lib/photo-storage";
import { RecordHeader } from "@/components/kit";
import {
  APPLIANCE_PILL,
  applianceSubtitle,
  applianceTitle,
} from "@/domains/inventory/words";

/**
 * The staff view of an appliance (AR-6 section 4): the shared record
 * header and the Overview facts only — no money, tax, parts prices or
 * history. Everything here comes from the operational DTO, which never
 * carries those fields in the first place.
 */
export async function OperationalAppliance({ id }: { id: string }) {
  const appliance = await getOperationalApplianceById(id);
  if (!appliance) notFound();
  const pill = APPLIANCE_PILL[appliance.status];
  return (
    <div className="max-w-2xl">
      <RecordHeader
        title={applianceTitle(appliance)}
        subtitle={applianceSubtitle(appliance)}
        back={{ href: "/desk/inventory", label: "Fleet" }}
        pills={[
          {
            label: pill.label,
            tone: pill.tone,
            info: appliance.status === "AWAITING_INSPECTION" ? "awaiting-inspection" : undefined,
          },
        ]}
        actions={[
          { kind: "link", label: "Print QR label", href: `/desk/inventory/${id}/qr` },
        ]}
      />
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
      <section className="mt-6">
        <h2 className="font-medium">Condition photos</h2>
        {appliance.photos.length === 0 ? (
          <p>No photos recorded.</p>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-3">
            {appliance.photos.map((photo) => (
              <Image
                key={photo.id}
                src={privatePhotoReadPath(photo.id)}
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
