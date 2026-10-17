"use client";

import { useCustomerTranslation } from "@/domains/language/client-portal";
import { useActionState } from "react";
import { saveCustomerLanguage, type LanguageActionResult } from "./language-actions";

export function LanguagePreferenceForm({ initialLanguage }: { initialLanguage: "en" | "es" }) {
  const t = useCustomerTranslation();
  const [state, action, pending] = useActionState<LanguageActionResult, FormData>(
    async (_previous, form: FormData) => {
      const result = await saveCustomerLanguage(form);
      return result;
    },
    { status: "idle", message: "" },
  );

  return (
    <form action={action} className="space-y-3">
      <label htmlFor="customer-language" className="block text-sm font-medium">Preferred language / Idioma preferido</label>
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
        {t("Spanish documents and messages require review before activation. English remains the controlling agreement.")}
      </p>
      <button type="submit" disabled={pending} className="rounded-md bg-action px-4 py-2 text-on-action disabled:opacity-50">
        {pending ? t("Saving…") : "Save language / Guardar idioma"}
      </button>
      <p role="status" aria-live="polite">{state.message ? t(state.message) : ""}</p>
    </form>
  );
}
