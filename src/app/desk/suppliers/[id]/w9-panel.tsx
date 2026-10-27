"use client";

import { useActionState, useState, useTransition } from "react";
import { recordTinAction, requestW9Action, setBackupWithholdingAction, type W9ActionState } from "./w9-actions";

/**
 * CMP-3: the W-9 panel on the supplier screen — request a one-time W-9
 * link, record a tax ID by hand, and the backup-withholding switch.
 * Only the last 4 digits of a tax ID are ever shown.
 */
export function W9Panel({
  supplierId,
  legalName,
  tinLast4,
  tinType,
  w9ReceivedOn,
  backupWithholding,
  isOwner,
  mailingAddress,
  hasW9File,
}: {
  supplierId: string;
  legalName: string;
  tinLast4: string | null;
  tinType: string | null;
  w9ReceivedOn: string | null;
  backupWithholding: boolean;
  isOwner: boolean;
  mailingAddress: string | null;
  hasW9File: boolean;
}) {
  const [requestState, setRequestState] = useState<W9ActionState>({});
  const [pending, start] = useTransition();
  const [tinState, tinDispatch, tinPending] = useActionState<W9ActionState, FormData>(
    (prev, formData) => recordTinAction(supplierId, prev, formData),
    {},
  );

  return (
    <section aria-labelledby="supplier-w9" className="space-y-3">
      <h2 id="supplier-w9" className="text-lg font-semibold text-ink">W-9 and tax ID</h2>
      {w9ReceivedOn ? (
        <p className="text-sm text-ink-soft">
          W-9 on file since {w9ReceivedOn}. Tax ID on file: {tinType ?? ""} ending …{tinLast4 ?? "????"} — the full
          number is encrypted and never shown.
          {mailingAddress ? <> Mailing address for 1099 copies: {mailingAddress}.</> : " No mailing address recorded yet — record it below so the 1099 copy can be mailed."}
          {hasW9File ? (
            <>
              {" "}
              <a className="underline" href={`/api/desk/suppliers/${supplierId}/w9-file`}>
                Open the W-9 file (PDF)
              </a>
            </>
          ) : null}
        </p>
      ) : (
        <p className="text-sm text-ink-soft">
          No W-9 on file. Federal rules require backup withholding of 24% from payments to a 1099 supplier until
          their W-9 arrives — ask for it before the next payment.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="rounded bg-ink px-3 py-2 text-sm text-white disabled:opacity-50"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setRequestState(await requestW9Action(supplierId));
            })
          }
        >
          {w9ReceivedOn ? "Send a fresh W-9 link" : "Ask for a W-9"}
        </button>
        {requestState.link ? (
          <span className="text-sm">
            One-time link (works once, 14 days): <span className="break-all font-mono text-xs">{requestState.link}</span>
            {requestState.emailed ? " — also emailed to the supplier." : ""}
          </span>
        ) : null}
        {requestState.error ? <span className="text-sm text-red-700">{requestState.error}</span> : null}
      </div>

      {isOwner ? (
        <form action={tinDispatch} className="grid max-w-xl gap-2 rounded-card bg-surface p-4">
          <p className="text-sm font-medium text-ink">Record a tax ID by hand (from a paper W-9)</p>
          <label className="text-sm">
            Legal name on the W-9
            <input name="legalName" defaultValue={legalName} className="mt-1 w-full rounded border border-border px-2 py-1.5" required />
          </label>
          <label className="text-sm">
            Tax ID type
            <select name="tinType" className="mt-1 w-full rounded border border-border px-2 py-1.5" defaultValue={tinType ?? "EIN"}>
              <option value="EIN">EIN (business)</option>
              <option value="SSN">SSN (person)</option>
            </select>
          </label>
          <label className="text-sm">
            Tax ID (9 digits)
            <input name="tin" inputMode="numeric" autoComplete="off" required className="mt-1 w-full rounded border border-border px-2 py-1.5" />
          </label>
          <label className="text-sm">
            Mailing address on the W-9 (street)
            <input name="mailingAddress" className="mt-1 w-full rounded border border-border px-2 py-1.5" />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-sm">
              City
              <input name="mailingCity" className="mt-1 w-full rounded border border-border px-2 py-1.5" />
            </label>
            <label className="text-sm">
              State
              <input name="mailingState" className="mt-1 w-full rounded border border-border px-2 py-1.5" />
            </label>
            <label className="text-sm">
              ZIP
              <input name="mailingZip" className="mt-1 w-full rounded border border-border px-2 py-1.5" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="backupWithholding" defaultChecked={backupWithholding} />
            Backup withholding applies (24% until a W-9 is on file)
          </label>
          {tinState.error ? <p className="text-sm text-red-700">{tinState.error}</p> : null}
          {tinState.ok ? <p className="text-sm text-green-800">Saved. Only the last 4 digits are kept on screen.</p> : null}
          <button type="submit" disabled={tinPending} className="w-fit rounded bg-ink px-3 py-2 text-sm text-white disabled:opacity-50">
            Save tax ID
          </button>
        </form>
      ) : null}

      {isOwner ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>
            Backup withholding is currently <strong>{backupWithholding ? "on" : "off"}</strong> for this supplier.
          </span>
          <button
            type="button"
            className="rounded border border-border px-3 py-1.5 disabled:opacity-50"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await setBackupWithholdingAction(supplierId, !backupWithholding);
                if (result.error) setRequestState(result);
              })
            }
          >
            Turn it {backupWithholding ? "off" : "on"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
