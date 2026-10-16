"use client";

import { useActionState } from "react";
import { saveCustomerLanguage } from "./language-actions";

export function LanguagePreferenceForm({ initialLanguage }: { initialLanguage: "en" | "es" }) {
  const [state, action, pending] = useActionState(
    async (_previous: { status: "idle" | "success" | "error"; message: string }, form: FormData) => {
      const result = await saveCustomerLanguage(form);
      return result;
    },
    { status: "idle" as const, message: "" },
  );

  return (
    <form action={action} className="space-y-3">
      <label htmlFor="customer-language" className="block text-sm font-medium">
        Preferred language / Idioma preferido
      </label>
      <select
        id="customer-language"
        name="language"
        defaultValue={initialLanguage}
        className="w-full rounded-md border border-line bg-surface px-3 py-2"
      >
        <option value="en">English</option>
        <option value="es">Español</option>
      </select>
      <p className="text-xs text-ink-soft">
        Spanish documents and messages require review before activation.
        English remains the controlling agreement.
      </p>
      <button type="submit" disabled={pending} className="rounded-md bg-primary px-4 py-2 text-white disabled:opacity-50">
        {pending ? "Saving…" : "Save language / Guardar idioma"}
      </button>
      <p role="status" aria-live="polite">{state.message}</p>
    </form>
  );
}
