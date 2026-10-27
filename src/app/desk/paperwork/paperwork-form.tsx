"use client";

import { useActionState } from "react";
import { Button, Field, Select, Textarea } from "@/components/ui";
import {
  PAPERWORK_GROUPS,
  PAPERWORK_STATUS_LABEL,
  RECORD_KINDS,
  RECORD_KIND_LABEL,
} from "@/domains/paperwork/rules";
import type { PaperworkFormState } from "./actions";

export type ObligationOption = { key: string; title: string };

export type PaperworkFormValues = {
  title: string;
  groupName: string;
  status: string;
  whatItIs: string;
  agency: string;
  officialUrl: string;
  referenceNumber: string;
  startedOn: string;
  dueOn: string;
  remindDaysBefore: number;
  repeatEveryMonths: string;
  notes: string;
  kind: string;
  issuedOn: string;
  expiresOn: string;
  numberLabel: string;
  /** Display only: whether a number is already stored (the number itself never comes back to the browser). */
  hasNumber: boolean;
  numberLast4: string;
  portalUrl: string;
  costDollars: string;
  linkedObligationKeys: string[];
};

export const EMPTY_PAPERWORK: PaperworkFormValues = {
  title: "",
  groupName: "Other",
  status: "TO_DO",
  whatItIs: "",
  agency: "",
  officialUrl: "",
  referenceNumber: "",
  startedOn: "",
  dueOn: "",
  remindDaysBefore: 30,
  repeatEveryMonths: "",
  notes: "",
  kind: "TASK",
  issuedOn: "",
  expiresOn: "",
  numberLabel: "",
  hasNumber: false,
  numberLast4: "",
  portalUrl: "",
  costDollars: "",
  linkedObligationKeys: [],
};

export function PaperworkForm({
  action,
  initial,
  submitLabel,
  obligationOptions = [],
}: {
  action: (state: PaperworkFormState, formData: FormData) => Promise<PaperworkFormState>;
  initial: PaperworkFormValues;
  submitLabel: string;
  obligationOptions?: ObligationOption[];
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as PaperworkFormState);
  return (
    <form action={formAction} className="max-w-2xl space-y-5">
      <Field label="What is it?" name="title" required defaultValue={initial.title} help="For example: Business liability insurance." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Where does it belong?" name="groupName" defaultValue={initial.groupName}>
          {PAPERWORK_GROUPS.map((group) => (
            <option key={group} value={group}>{group}</option>
          ))}
        </Select>
        <Select label="What kind of record is it?" name="kind" defaultValue={initial.kind}>
          {RECORD_KINDS.map((kind) => (
            <option key={kind} value={kind}>{RECORD_KIND_LABEL[kind]}</option>
          ))}
        </Select>
      </div>
      <Select label="Where are you with it?" name="status" defaultValue={initial.status}>
        {Object.entries(PAPERWORK_STATUS_LABEL).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </Select>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="What is the number called?"
          name="numberLabel"
          defaultValue={initial.numberLabel}
          autoComplete="off"
          help="For example: EIN, Policy number, Account number."
        />
        <Field
          label={initial.hasNumber ? `Number (on file: ••••${initial.numberLast4 ?? ""})` : "Number (optional)"}
          name="numberValue"
          defaultValue=""
          autoComplete="off"
          help={
            initial.hasNumber
              ? "Leave blank to keep the number on file. Type a new one to replace it. Numbers are stored encrypted; only the owner sees them, and only ever masked."
              : "Stored encrypted. Only the owner can see it, and only ever masked (last four characters). It is kept out of the activity log."
          }
        />
      </div>
      <Field
        label="Reference (optional, not secret)"
        name="referenceNumber"
        defaultValue={initial.referenceNumber}
        autoComplete="off"
        help="A reference you don't mind being plain text (a confirmation or case number). Only the owner can see this. It is kept out of the activity log."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Started on" name="startedOn" type="date" defaultValue={initial.startedOn} />
        <Field label="Issued on" name="issuedOn" type="date" defaultValue={initial.issuedOn} />
        <Field
          label="Expires on"
          name="expiresOn"
          type="date"
          defaultValue={initial.expiresOn}
          help="When the document itself runs out (a license, a policy). You get a reminder before it."
        />
        <Field
          label="Next action date"
          name="dueOn"
          type="date"
          defaultValue={initial.dueOn}
          help="The next thing that's due, if different from the expiry. Reminders use whichever date comes first."
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Remind me this many days before"
          name="remindDaysBefore"
          type="number"
          min={0}
          max={365}
          defaultValue={initial.remindDaysBefore}
        />
        <Field
          label="Comes back every (months)"
          name="repeatEveryMonths"
          type="number"
          min={1}
          max={120}
          defaultValue={initial.repeatEveryMonths}
          help="12 for yearly. Leave empty if it happens once. Used by 'Mark done and schedule the next one' and 'Renewed…'."
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Who handles it" name="agency" defaultValue={initial.agency} help="The office or company, for example Colorado Secretary of State." />
        <Field
          label="Cost (optional)"
          name="costDollars"
          inputMode="decimal"
          defaultValue={initial.costDollars}
          help="The yearly or renewal cost in dollars, if there is one. Used by your budget."
        />
      </div>
      <Field label="Website (optional)" name="officialUrl" type="url" defaultValue={initial.officialUrl} help="Must start with https://" />
      <Field
        label="Portal / sign-in page (optional)"
        name="portalUrl"
        type="url"
        defaultValue={initial.portalUrl}
        help="Where you sign in or manage this — for example Revenue Online. Must start with https://"
      />
      {obligationOptions.length > 0 && (
        <fieldset>
          <legend className="text-sm font-semibold">This record is used for (compliance list)</legend>
          <p className="mt-1 text-xs text-ink-soft">
            Tick the filings or accounts this record unlocks or feeds. Linked filings can warn you when the document behind them is expiring.
          </p>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            {obligationOptions.map((option) => (
              <label key={option.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="obligationKey"
                  value={option.key}
                  defaultChecked={initial.linkedObligationKeys.includes(option.key)}
                />
                {option.title}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Textarea label="What it is, in plain words" name="whatItIs" rows={4} defaultValue={initial.whatItIs} />
      <Textarea label="Your own notes" name="notes" rows={3} defaultValue={initial.notes} help="Who you talked to, what they said, where the papers are kept." />
      {state.status === "error" && (
        <p role="alert" className="text-sm font-semibold text-danger">{state.message}</p>
      )}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
    </form>
  );
}
