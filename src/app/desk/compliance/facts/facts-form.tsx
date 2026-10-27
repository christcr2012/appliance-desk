"use client";

import { useActionState } from "react";
import { saveFactsAction, type ComplianceActionState } from "../actions";

type Props = {
  entityType: string;
  einLast4: string | null;
  einKeyReady: boolean;
  sosReportMonth: number | null;
  truckGvwrLbs: number | null;
  employees: number;
  hasHomeOffice: boolean;
  payer: {
    businessLegalName: string;
    businessAddress: string;
    businessCity: string;
    businessState: string;
    businessZip: string;
    businessPhone: string;
  };
};

const inputCls = "w-full rounded-lg border border-border bg-card px-3 py-2";
const labelCls = "block text-sm font-medium text-ink";
const helpCls = "mt-1 text-sm text-ink-soft";

export function FactsForm(props: Props) {
  const [state, formAction, pending] = useActionState<ComplianceActionState, FormData>(
    saveFactsAction,
    {},
  );
  return (
    <form action={formAction} className="max-w-xl space-y-5">
      {state.error ? (
        <p role="alert" className="rounded-card bg-danger-tint px-4 py-3 text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p className="rounded-card bg-tint px-4 py-3 text-sm font-medium text-ink">Saved.</p>
      ) : null}

      <div>
        <label className={labelCls} htmlFor="entityType">
          Business type
        </label>
        <select id="entityType" name="entityType" defaultValue={props.entityType} className={inputCls}>
          <option value="SINGLE_MEMBER_LLC">Single-member LLC (just you)</option>
          <option value="MULTI_MEMBER_LLC">Multi-member LLC</option>
          <option value="S_CORP">S corporation</option>
        </select>
        <p className={helpCls}>
          This decides which federal return you file. It&apos;s a starting value — your CPA confirms it in
          Decisions &amp; reviews.
        </p>
      </div>

      <div>
        <label className={labelCls} htmlFor="ein">
          Business EIN (tax ID)
        </label>
        {props.einKeyReady ? (
          <input
            id="ein"
            name="ein"
            inputMode="numeric"
            autoComplete="off"
            placeholder={props.einLast4 ? `On file, ending ${props.einLast4} — type to replace` : "XX-XXXXXXX"}
            className={inputCls}
          />
        ) : (
          <input id="ein" name="ein" disabled placeholder="Not available yet" className={inputCls} />
        )}
        <p className={helpCls}>
          {props.einKeyReady
            ? "Stored encrypted. Only the last 4 digits are ever shown, and the full number is never written to a log."
            : "Ask your developer to set the encryption key (it's on your owner checklist) — until then the EIN can't be stored safely, so this box is off."}
        </p>
        {props.einLast4 ? (
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name="clearEin" /> Remove the EIN on file (ending {props.einLast4})
          </label>
        ) : null}
      </div>

      <div>
        <label className={labelCls} htmlFor="sosReportMonth">
          LLC report month (Secretary of State)
        </label>
        <select
          id="sosReportMonth"
          name="sosReportMonth"
          defaultValue={props.sosReportMonth ?? ""}
          className={inputCls}
        >
          <option value="">Not set yet</option>
          {[
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
          ].map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
        <p className={helpCls}>The month your LLC was formed — it&apos;s on the Secretary of State summary page for your LLC.</p>
      </div>

      <div>
        <label className={labelCls} htmlFor="truckGvwrLbs">
          Truck weight rating (GVWR, pounds)
        </label>
        <input
          id="truckGvwrLbs"
          name="truckGvwrLbs"
          inputMode="numeric"
          defaultValue={props.truckGvwrLbs ?? ""}
          placeholder="e.g. 14000"
          className={inputCls}
        />
        <p className={helpCls}>On the sticker inside the driver&apos;s door. At 16,001 lb or more you need a USDOT number.</p>
      </div>

      <div>
        <label className={labelCls} htmlFor="employees">
          Employees (not counting you)
        </label>
        <input
          id="employees"
          name="employees"
          inputMode="numeric"
          defaultValue={props.employees}
          className={inputCls}
        />
        <p className={helpCls}>Payroll taxes stay asleep until this is more than zero.</p>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium text-ink">
        <input type="checkbox" name="hasHomeOffice" defaultChecked={props.hasHomeOffice} />
        I run the business from a home office
      </label>

      <fieldset className="space-y-4 border-t border-border pt-5">
        <legend className="text-sm font-semibold text-ink">Name and address on 1099s (the payer block)</legend>
        <p className={helpCls}>
          This is what prints as the payer on every 1099 you send, and what the IRS portal file carries. Use
          the legal name and mailing address from your EIN paperwork.
        </p>
        <div>
          <label className={labelCls} htmlFor="businessLegalName">Business legal name</label>
          <input id="businessLegalName" name="businessLegalName" defaultValue={props.payer.businessLegalName} className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="businessAddress">Mailing address</label>
          <input id="businessAddress" name="businessAddress" defaultValue={props.payer.businessAddress} className={inputCls} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls} htmlFor="businessCity">City</label>
            <input id="businessCity" name="businessCity" defaultValue={props.payer.businessCity} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="businessState">State</label>
            <input id="businessState" name="businessState" defaultValue={props.payer.businessState} maxLength={2} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="businessZip">ZIP</label>
            <input id="businessZip" name="businessZip" defaultValue={props.payer.businessZip} className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="businessPhone">Phone (optional)</label>
          <input id="businessPhone" name="businessPhone" defaultValue={props.payer.businessPhone} className={inputCls} />
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-action bg-action px-4 py-2 text-sm font-medium text-on-action disabled:opacity-50"
      >
        Save business facts
      </button>
    </form>
  );
}
