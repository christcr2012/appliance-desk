"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import {
  Button,
  Checkbox,
  DataList,
  EmptyState,
  Field,
  StatusPill,
  type DataListColumn,
} from "@/components/ui";
import {
  updateAppliancePriceAction,
  setApplianceVisibilityAction,
  createApplianceTypeAction,
  setApplianceTypeActiveAction,
  setAppliancePhotoUrlAction,
} from "./actions";
import { PhotoUploadField } from "@/components/photo-upload-field";

type ApplianceTypeRow = {
  id: string;
  name: string;
  monthlyPriceCents: number;
  showOnWebsite: boolean;
  isActive: boolean;
  photoUrl: string | null;
};

const columns: DataListColumn<ApplianceTypeRow>[] = [
  {
    key: "appliance",
    header: "Appliance",
    primary: true,
    cell: (row) => (
      <div className="space-y-2">
        <p className="font-semibold text-ink">{row.name}</p>
        <StatusPill
          tone={row.isActive ? "success" : "stopped"}
          label={row.isActive ? "Active" : "Retired"}
        />
      </div>
    ),
  },
  {
    key: "controls",
    header: "Pricing and website",
    cell: (row) => <ApplianceControls row={row} />,
  },
];

export function AppliancePricingTable({ rows }: { rows: ApplianceTypeRow[] }) {
  const active = rows.filter((row) => row.isActive);
  const retired = rows.filter((row) => !row.isActive);

  return (
    <div className="min-w-0 max-w-full space-y-6">
      <p className="text-sm text-ink-soft">
        Add a new category any time you&apos;re ready to offer it
        (refrigerators, ranges, etc.) — no developer needed. It starts hidden
        from the website until you turn on &quot;Show on website&quot;.
      </p>

      <DataList
        rows={active}
        columns={columns}
        caption="Active appliance types"
        empty={
          <EmptyState
            title="No active appliance types"
            description="Add the first appliance type below."
          />
        }
      />

      <NewApplianceTypeForm />

      {retired.length > 0 && (
        <details className="max-w-4xl rounded-card border border-line bg-surface p-4">
          <summary className="cursor-pointer font-semibold text-ink">
            Retired appliance types ({retired.length})
          </summary>
          <div className="mt-4">
            <DataList
              rows={retired}
              columns={columns}
              caption="Retired appliance types"
              empty={null}
            />
          </div>
        </details>
      )}
    </div>
  );
}

function ApplianceControls({ row }: { row: ApplianceTypeRow }) {
  const [price, setPrice] = useState(
    (row.monthlyPriceCents / 100).toFixed(2),
  );
  const [visible, setVisible] = useState(row.showOnWebsite);
  const [photoUrl, setPhotoUrl] = useState(row.photoUrl ?? "");
  const [isPending, startTransition] = useTransition();
  const [isPhotoPending, startPhotoTransition] = useTransition();
  const [priceMessage, setPriceMessage] = useState<
    { kind: "success" | "error"; text: string } | null
  >(null);
  const [photoMessage, setPhotoMessage] = useState<
    { kind: "success" | "error"; text: string } | null
  >(null);

  function savePhotoUrl(url: string) {
    startPhotoTransition(async () => {
      const result = await setAppliancePhotoUrlAction(row.id, url);
      if (result.status === "error") {
        setPhotoMessage({ kind: "error", text: result.message });
      } else {
        setPhotoUrl(url);
        setPhotoMessage({
          kind: "success",
          text: url ? "Photo saved." : "Photo removed.",
        });
      }
    });
  }

  return (
    <div className={`space-y-4 ${!row.isActive ? "opacity-70" : ""}`}>
      <div className="grid gap-3 sm:grid-cols-[minmax(10rem,14rem)_auto] sm:items-end">
        <Field
          label={`Monthly price for ${row.name}`}
          type="number"
          min={0}
          step="0.01"
          value={price}
          disabled={isPending || !row.isActive}
          onChange={(event) => {
            setPrice(event.target.value);
            setPriceMessage(null);
          }}
        />
        <Button
          type="button"
          disabled={isPending || !row.isActive}
          onClick={() => {
            setPriceMessage(null);
            startTransition(async () => {
              try {
                const result = await updateAppliancePriceAction(
                  row.id,
                  parseFloat(price),
                );
                setPriceMessage(
                  result.status === "success"
                    ? { kind: "success", text: "Saved" }
                    : {
                        kind: "error",
                        text:
                          result.status === "error"
                            ? result.message
                            : "Price save was not confirmed. Reload to check it before retrying.",
                      },
                );
              } catch {
                setPriceMessage({
                  kind: "error",
                  text: "Price save was not confirmed. Your amount is still here; reload to check it before retrying.",
                });
              }
            });
          }}
        >
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>

      {priceMessage && !isPending && (
        <p
          role={priceMessage.kind === "error" ? "alert" : "status"}
          className={`text-sm font-medium ${
            priceMessage.kind === "error" ? "text-danger" : "text-success"
          }`}
        >
          {priceMessage.text}
        </p>
      )}

      <Checkbox
        label={`Show ${row.name} on website`}
        checked={visible}
        disabled={!row.isActive}
        onChange={(event) => {
          const next = event.target.checked;
          setVisible(next);
          startTransition(() => {
            setApplianceVisibilityAction(row.id, next);
          });
        }}
      />

      <div className="space-y-2">
        <p className="text-sm font-semibold text-ink">Photo</p>
        <div className="flex flex-wrap items-center gap-3">
          {photoUrl && (
            <Image
              src={photoUrl}
              alt={`${row.name} photo`}
              width={56}
              height={56}
              className="h-14 w-14 rounded-control object-cover"
            />
          )}
          <PhotoUploadField
            pathPrefix="appliance-types"
            access="public"
            label={photoUrl ? "Replace photo" : "Add photo"}
            disabled={isPhotoPending || !row.isActive}
            onUploaded={(url) => {
              setPhotoMessage(null);
              savePhotoUrl(url);
            }}
            onError={(message) =>
              setPhotoMessage({ kind: "error", text: message })
            }
          />
          {photoUrl && (
            <Button
              type="button"
              variant="quiet"
              disabled={isPhotoPending || !row.isActive}
              onClick={() => {
                setPhotoMessage(null);
                savePhotoUrl("");
              }}
            >
              Remove
            </Button>
          )}
        </div>
        {photoMessage && (
          <p
            role={photoMessage.kind === "error" ? "alert" : "status"}
            className={`text-sm font-medium ${
              photoMessage.kind === "success" ? "text-success" : "text-danger"
            }`}
          >
            {photoMessage.text}
          </p>
        )}
      </div>

      <Button
        type="button"
        variant={row.isActive ? "danger" : "secondary"}
        disabled={isPending}
        onClick={() => {
          if (row.isActive) {
            setVisible(false);
          }
          startTransition(() => {
            setApplianceTypeActiveAction(row.id, !row.isActive);
          });
        }}
      >
        {row.isActive ? "Retire" : "Restore"}
      </Button>
    </div>
  );
}

function NewApplianceTypeForm() {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("35.00");
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<
    { kind: "success" | "error"; text: string } | null
  >(null);

  return (
    <form
      className="max-w-md space-y-4 rounded-card border border-line bg-subtle p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        startTransition(async () => {
          const result = await createApplianceTypeAction({
            name,
            monthlyPriceDollars: parseFloat(price) || 0,
          });
          if (result.status === "success") {
            setMessage({ kind: "success", text: `${name} added.` });
            setName("");
            setPrice("35.00");
          } else if (result.status === "error") {
            setMessage({ kind: "error", text: result.message });
          }
        });
      }}
    >
      <h3 className="font-semibold text-ink">Add an appliance type</h3>
      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`rounded-control border border-line bg-surface px-3 py-2 text-sm font-medium ${
            message.kind === "success" ? "text-success" : "text-danger"
          }`}
        >
          {message.text}
        </p>
      )}
      <Field
        id="new-appliance-name"
        label="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Refrigerator"
        required
      />
      <div className="max-w-xs">
        <Field
          id="new-appliance-price"
          label="Monthly price"
          type="number"
          min={0}
          step="0.01"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
      </div>
      <Button type="submit" disabled={isPending || !name.trim()}>
        {isPending ? "Adding…" : "Add appliance type"}
      </Button>
    </form>
  );
}
