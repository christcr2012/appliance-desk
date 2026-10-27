"use client";

import { useActionState } from "react";
import { Button, Field } from "@/components/ui";
import {
  saveStepFileAction,
  saveStepNumberAction,
  type StepSaveState,
} from "../actions";

/**
 * SETUP-1: the "save what this step produced" forms on a walkthrough step —
 * the account number (goes onto the business record, encrypted) and/or the
 * file (attached to the record through the same checks as Business records).
 */
export function StepSaveForms({
  walkthroughKey,
  stepKey,
  numberLabel,
  showNumber,
  showFile,
}: {
  walkthroughKey: string;
  stepKey: string;
  numberLabel: string | null;
  showNumber: boolean;
  showFile: boolean;
}) {
  const [numberState, numberAction, numberPending] = useActionState(
    saveStepNumberAction.bind(null, walkthroughKey, stepKey),
    { status: "idle" } as StepSaveState,
  );
  const [fileState, fileAction, filePending] = useActionState(
    saveStepFileAction.bind(null, walkthroughKey, stepKey),
    { status: "idle" } as StepSaveState,
  );
  return (
    <div>
      {showNumber ? (
        <form action={numberAction}>
          <Field
            label={numberLabel ? `Save the ${numberLabel}` : "Save the number"}
            name="numberValue"
            type="text"
            autoComplete="off"
            required
            help="Stored encrypted on the business record. Only the last 4 digits ever show."
            error={numberState.status === "error" ? numberState.message : undefined}
          />
          {numberState.status === "saved" ? <p>Saved to the record.</p> : null}
          <Button type="submit" disabled={numberPending}>
            {numberPending ? "Saving…" : "Save number"}
          </Button>
        </form>
      ) : null}
      {showFile ? (
        <form action={fileAction}>
          <Field
            label="Attach the file"
            name="file"
            type="file"
            accept=".pdf,image/png,image/jpeg,image/webp"
            required
            help="PDFs and photos up to 900 KB here; a bigger PDF can be attached from the record itself. Files are stored privately."
            error={fileState.status === "error" ? fileState.message : undefined}
          />
          {fileState.status === "saved" ? <p>Saved to the record.</p> : null}
          <Button type="submit" disabled={filePending}>
            {filePending ? "Saving…" : "Save file"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
