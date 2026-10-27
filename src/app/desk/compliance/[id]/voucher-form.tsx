"use client";

import { useState } from "react";

/**
 * CMP-2: the voucher identity form. The owner's name and Social Security
 * number are typed here and sent only with this download request — the
 * server fills the voucher PDF and forgets them; nothing is saved.
 */
export function VoucherForm({
  filingId,
  quarter,
  jurisdiction,
  defaultAddress,
}: {
  filingId: string;
  quarter: number;
  jurisdiction: "FEDERAL" | "COLORADO";
  defaultAddress: { address: string; city: string; state: string; zip: string };
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function download(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch(`/desk/compliance/${filingId}/outputs?kind=voucher`, {
        method: "POST",
        body: new FormData(event.currentTarget),
      });
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = jurisdiction === "FEDERAL" ? `1040-es-voucher-q${quarter}.pdf` : `dr-0104ep-voucher-q${quarter}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The voucher could not be built.");
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-lg border border-border bg-card px-3 py-2";
  const label = "block text-sm";
  return (
    <form onSubmit={download} className="max-w-3xl space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className={label}>
          <span className="mb-1 block font-medium text-ink">First name</span>
          <input name="firstName" required className={input} autoComplete="off" />
        </label>
        <label className={label}>
          <span className="mb-1 block font-medium text-ink">Middle initial</span>
          <input name="middleInitial" maxLength={1} className={input} autoComplete="off" />
        </label>
        <label className={label}>
          <span className="mb-1 block font-medium text-ink">Last name</span>
          <input name="lastName" required className={input} autoComplete="off" />
        </label>
        <label className={label}>
          <span className="mb-1 block font-medium text-ink">Social Security number</span>
          <input name="ssn" required inputMode="numeric" placeholder="123-45-6789" className={input} autoComplete="off" />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className={`${label} col-span-2`}>
          <span className="mb-1 block font-medium text-ink">Address</span>
          <input name="address" defaultValue={defaultAddress.address} className={input} autoComplete="off" />
        </label>
        <label className={label}>
          <span className="mb-1 block font-medium text-ink">City</span>
          <input name="city" defaultValue={defaultAddress.city} className={input} autoComplete="off" />
        </label>
        <label className={label}>
          <span className="mb-1 block font-medium text-ink">State / ZIP</span>
          <span className="flex gap-2">
            <input name="state" defaultValue={defaultAddress.state} className={input} autoComplete="off" />
            <input name="zip" defaultValue={defaultAddress.zip} className={input} autoComplete="off" />
          </span>
        </label>
      </div>
      {error ? (
        <p role="alert" className="rounded-card bg-danger-tint px-4 py-3 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
      >
        {busy ? "Filling…" : jurisdiction === "FEDERAL" ? "Download the filled 1040-ES voucher (PDF)" : "Download the filled DR 0104EP voucher (PDF)"}
      </button>
      <p className="text-sm text-ink-soft">
        Your Social Security number is used only to fill this voucher and is never saved.{" "}
        {jurisdiction === "FEDERAL"
          ? "Print the voucher page for this quarter from the booklet and mail it with a check, or pay online at IRS Direct Pay."
          : "Print the voucher page (page 5 of the booklet) and mail it with a check, or pay online at Colorado Revenue Online."}
      </p>
    </form>
  );
}
