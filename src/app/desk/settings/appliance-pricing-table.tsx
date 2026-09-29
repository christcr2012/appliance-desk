"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
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

export function AppliancePricingTable({ rows }: { rows: ApplianceTypeRow[] }) {
  const active = rows.filter((r) => r.isActive);
  const retired = rows.filter((r) => !r.isActive);

  return (
    <div className="space-y-6">
      <div className="max-w-3xl overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <caption className="mb-2 text-left text-gray-600">
            Add a new category any time you&apos;re ready to offer it
            (refrigerators, ranges, etc.) — no developer needed. It starts
            hidden from the website until you turn on &quot;Show on
            website&quot;.
          </caption>
          <thead>
            <tr className="border-b border-gray-200 text-left">
              <th className="py-2 pr-4 font-medium text-gray-900">Appliance</th>
              <th className="py-2 pr-4 font-medium text-gray-900">
                Monthly price
              </th>
              <th className="py-2 pr-4 font-medium text-gray-900">
                Show on website
              </th>
              <th className="py-2 pr-4 font-medium text-gray-900">Photo</th>
              <th className="py-2 font-medium text-gray-900">
                <span className="sr-only">Retire</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {active.map((row) => (
              <ApplianceRow key={row.id} row={row} />
            ))}
          </tbody>
        </table>
      </div>

      <NewApplianceTypeForm />

      {retired.length > 0 && (
        <details className="max-w-3xl rounded-lg border border-gray-200 p-4">
          <summary className="cursor-pointer text-sm font-medium text-gray-700">
            Retired appliance types ({retired.length})
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <tbody>
                {retired.map((row) => (
                  <ApplianceRow key={row.id} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function ApplianceRow({ row }: { row: ApplianceTypeRow }) {
  const [price, setPrice] = useState((row.monthlyPriceCents / 100).toFixed(2));
  const [visible, setVisible] = useState(row.showOnWebsite);
  const [photoUrl, setPhotoUrl] = useState(row.photoUrl ?? "");
  const [isPending, startTransition] = useTransition();
  const [isPhotoPending, startPhotoTransition] = useTransition();
  const [savedPrice, setSavedPrice] = useState(false);
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
        setPhotoMessage({ kind: "success", text: url ? "Photo saved." : "Photo removed." });
      }
    });
  }

  return (
    <tr className={`border-b border-gray-100 ${!row.isActive ? "opacity-60" : ""}`}>
      <td className="py-3 pr-4 text-gray-900">{row.name}</td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`price-${row.id}`}>
            Monthly price for {row.name}
          </label>
          <span aria-hidden="true">$</span>
          <input
            id={`price-${row.id}`}
            type="number"
            min={0}
            step="0.01"
            value={price}
            disabled={!row.isActive}
            onChange={(e) => {
              setPrice(e.target.value);
              setSavedPrice(false);
            }}
            className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 disabled:bg-gray-50"
          />
          <button
            type="button"
            disabled={isPending || !row.isActive}
            onClick={() => {
              startTransition(async () => {
                await updateAppliancePriceAction(row.id, parseFloat(price));
                setSavedPrice(true);
              });
            }}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {isPending ? "Saving…" : "Save"}
          </button>
          {savedPrice && !isPending && (
            <span className="text-xs text-green-700">Saved</span>
          )}
        </div>
      </td>
      <td className="py-3 pr-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={visible}
            disabled={!row.isActive}
            onChange={(e) => {
              const next = e.target.checked;
              setVisible(next);
              startTransition(() => {
                setApplianceVisibilityAction(row.id, next);
              });
            }}
            className="h-4 w-4"
          />
          <span className="sr-only">Show {row.name} on website</span>
        </label>
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          {photoUrl && (
            <Image
              src={photoUrl}
              alt={`${row.name} photo`}
              width={40}
              height={40}
              className="h-10 w-10 rounded-md object-cover"
            />
          )}
          <PhotoUploadField
            pathPrefix="appliance-types"
            label={photoUrl ? "Replace photo" : "Add photo"}
            disabled={isPhotoPending || !row.isActive}
            onUploaded={(url) => {
              setPhotoMessage(null);
              savePhotoUrl(url);
            }}
            onError={(message) => setPhotoMessage({ kind: "error", text: message })}
          />
          {photoUrl && (
            <button
              type="button"
              disabled={isPhotoPending || !row.isActive}
              onClick={() => {
                setPhotoMessage(null);
                savePhotoUrl("");
              }}
              className="text-xs font-medium text-gray-600 underline hover:text-gray-900 disabled:opacity-60"
            >
              Remove
            </button>
          )}
        </div>
        {photoMessage && (
          <p
            className={`mt-1 text-xs ${
              photoMessage.kind === "success" ? "text-green-700" : "text-red-700"
            }`}
          >
            {photoMessage.text}
          </p>
        )}
      </td>
      <td className="py-3">
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            if (row.isActive) {
              setVisible(false);
            }
            startTransition(() => {
              setApplianceTypeActiveAction(row.id, !row.isActive);
            });
          }}
          className="text-xs font-medium text-gray-600 underline hover:text-gray-900 disabled:opacity-60"
        >
          {row.isActive ? "Retire" : "Restore"}
        </button>
      </td>
    </tr>
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
      className="max-w-md space-y-3 rounded-lg border border-gray-200 p-4"
      onSubmit={(e) => {
        e.preventDefault();
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
      <h3 className="text-sm font-semibold text-gray-900">
        Add an appliance type
      </h3>
      {message && (
        <p
          role="status"
          className={`rounded-md px-3 py-2 text-xs ${
            message.kind === "success"
              ? "bg-green-50 text-green-800"
              : "bg-red-50 text-red-800"
          }`}
        >
          {message.text}
        </p>
      )}
      <div>
        <label htmlFor="new-appliance-name" className="mb-1 block text-xs font-medium text-gray-900">
          Name
        </label>
        <input
          id="new-appliance-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Refrigerator"
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="new-appliance-price" className="mb-1 block text-xs font-medium text-gray-900">
          Monthly price
        </label>
        <div className="flex items-center gap-2">
          <span aria-hidden="true">$</span>
          <input
            id="new-appliance-price"
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={isPending || !name.trim()}
        className="rounded-full bg-gray-900 px-5 py-2 text-xs font-semibold text-white disabled:opacity-60"
      >
        {isPending ? "Adding…" : "Add appliance type"}
      </button>
    </form>
  );
}
