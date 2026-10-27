"use client";

import { useActionState } from "react";
import { Button, Checkbox, Field, Select, Textarea } from "@/components/ui";
import type { VaultFormState } from "./actions";

const initial: VaultFormState = { status: "idle" };

export type CredentialFormInitial = {
  title: string;
  url: string;
  totpHint: string;
  rotateEveryMonths: string;
  hasUsername: boolean;
  hasPassword: boolean;
  hasNotes: boolean;
};

/**
 * VAULT-2: the add/edit login form. Secret boxes are always empty on
 * purpose: type to replace a saved value, tick "Remove" to clear one, and
 * leave both alone to keep what's saved. Saving a secret change needs an
 * unlock — the server refuses without one and the message says why.
 */
export function CredentialForm({
  action,
  initialValues,
  submitLabel,
  unlocked,
}: {
  action: (previous: VaultFormState, formData: FormData) => Promise<VaultFormState>;
  initialValues?: CredentialFormInitial;
  submitLabel: string;
  unlocked: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  const editing = initialValues != null;

  const secretField = (
    name: "username" | "password" | "notes",
    label: string,
    hasValue: boolean,
    help: string,
  ) => (
    <div>
      {name === "notes" ? (
        <Textarea label={label} name={name} help={help} autoComplete="off" rows={3} />
      ) : (
        <Field
          label={label}
          name={name}
          type={name === "password" ? "password" : "text"}
          help={help}
          autoComplete="off"
          placeholder={hasValue ? "Saved — type to replace it" : undefined}
        />
      )}
      {editing && hasValue && (
        <div className="mt-1">
          <Checkbox label={`Remove the saved ${name}`} name={`clear_${name}`} />
        </div>
      )}
    </div>
  );

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Name" name="title" required defaultValue={initialValues?.title ?? ""} placeholder="Colorado Revenue Online" />
      <Field label="Website (optional)" name="url" defaultValue={initialValues?.url ?? ""} placeholder="https://…" help="The sign-in page, starting with https://" />
      {secretField("username", "Username", initialValues?.hasUsername ?? false, "Usually the email or account name you sign in with. Stored encrypted.")}
      {secretField("password", "Password", initialValues?.hasPassword ?? false, "Stored encrypted. Shown only after a fresh sign-in code.")}
      {secretField("notes", "Notes (optional)", initialValues?.hasNotes ?? false, "Security answers, recovery codes, PINs — anything you need alongside the password. Stored encrypted.")}
      <Field
        label="Where the second-step code comes from (optional)"
        name="totpHint"
        defaultValue={initialValues?.totpHint ?? ""}
        placeholder="Authenticator app on my phone"
        help="A reminder for you — never save the secret code itself here."
      />
      <Select
        label="Remind me to change the password"
        name="rotateEveryMonths"
        defaultValue={initialValues?.rotateEveryMonths ?? ""}
        help="When it's due, the reminder lands on your To do list."
      >
        <option value="">No reminder</option>
        <option value="3">Every 3 months</option>
        <option value="6">Every 6 months</option>
        <option value="12">Every 12 months</option>
        <option value="24">Every 24 months</option>
      </Select>
      {!unlocked && (
        <p className="text-sm text-ink-soft">
          The name and website can be saved any time. Saving a username, password or note needs the vault
          unlocked first — unlock it above, then save.
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className="text-sm font-semibold text-danger">{state.message}</p>
      )}
      {state.status === "saved" && <p className="text-sm text-ink-soft">Saved.</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
