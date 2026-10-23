"use client";

import { useActionState } from "react";
import { Button, Field, Select, Textarea } from "@/components/ui";
import { PAPERWORK_GROUPS, PAPERWORK_STATUS_LABEL } from "@/domains/paperwork/rules";
import type { PaperworkFormState } from "./actions";

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
};

export function PaperworkForm({
  action,
  initial,
  submitLabel,
}: {
  action: (state: PaperworkFormState, formData: FormData) => Promise<PaperworkFormState>;
  initial: PaperworkFormValues;
  submitLabel: string;
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
        <Select label="Where are you with it?" name="status" defaultValue={initial.status}>
          {Object.entries(PAPERWORK_STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
      </div>
      <Field
        label="Number (optional)"
        name="referenceNumber"
        defaultValue={initial.referenceNumber}
        autoComplete="off"
        help="An EIN, license or policy number. Only the owner can see this. It is kept out of the activity log."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Started or issued on" name="startedOn" type="date" defaultValue={initial.startedOn} />
        <Field
          label="Next due, renewal or expiry date"
          name="dueOn"
          type="date"
          defaultValue={initial.dueOn}
          help="Leave empty if there is no date. When a date is set, you get a reminder on your Today list."
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
          help="12 for yearly. Leave empty if it happens once. Used by 'Mark done and schedule the next one'."
        />
      </div>
      <Field label="Who handles it" name="agency" defaultValue={initial.agency} help="The office or company, for example Colorado Secretary of State." />
      <Field label="Website (optional)" name="officialUrl" type="url" defaultValue={initial.officialUrl} help="Must start with https://" />
      <Textarea label="What it is, in plain words" name="whatItIs" rows={4} defaultValue={initial.whatItIs} />
      <Textarea label="Your own notes" name="notes" rows={3} defaultValue={initial.notes} help="Who you talked to, what they said, where the papers are kept." />
      {state.status === "error" && (
        <p role="alert" className="text-sm font-semibold text-danger">{state.message}</p>
      )}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
    </form>
  );
}

