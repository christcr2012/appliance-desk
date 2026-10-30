"use client";

import { useRouter } from "next/navigation";

/**
 * PORTAL-1 section 5.1: the Home property picker is a native select;
 * changing it navigates to the existing ?address= param (the server
 * still narrows every read to the signed-in customer's own addresses).
 */
export function PropertyPicker({
  label,
  allLabel,
  addresses,
  selectedId,
}: {
  label: string;
  allLabel: string;
  addresses: { id: string; line1: string; line2: string | null; city: string }[];
  selectedId?: string;
}) {
  const router = useRouter();
  return (
    <div className="mb-5">
      <label htmlFor="portal-property" className="text-sm font-semibold text-ink">
        {label}
      </label>
      <select
        id="portal-property"
        value={selectedId ?? ""}
        onChange={(event) => {
          const value = event.target.value;
          router.push(value ? `/account?address=${encodeURIComponent(value)}` : "/account");
        }}
        className="mt-1 block min-h-11 w-full max-w-md rounded-control border border-line-strong bg-surface px-3 py-2 text-ink"
      >
        <option value="">{allLabel}</option>
        {addresses.map((address) => (
          <option key={address.id} value={address.id}>
            {address.line1}
            {address.line2 ? `, ${address.line2}` : ""}, {address.city}
          </option>
        ))}
      </select>
    </div>
  );
}
