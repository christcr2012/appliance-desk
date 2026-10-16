"use client";

import { useState, useTransition } from "react";
import { chooseQuoteLanguage } from "./language-actions";
import type { CustomerLanguage } from "@/domains/language/copy";

export function QuoteLanguageChoice({
  estimateId, preferredLanguage,
}: { estimateId: string; preferredLanguage: CustomerLanguage }) {
  const [language, setLanguage] = useState(preferredLanguage);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const choose = (next: CustomerLanguage) => start(async () => {
    try {
      setLanguage(await chooseQuoteLanguage(estimateId, next));
      setError("");
    } catch {
      setError("Could not save language. / No se pudo guardar el idioma.");
    }
  });
  return (
    <section aria-label="Language / Idioma" className="my-4 rounded-md border border-line p-3 text-sm">
      <div className="flex items-center gap-3">
        <span>Language / Idioma:</span>
        <button type="button" disabled={pending} aria-pressed={language === "en"}
          onClick={() => choose("en")} className="rounded border border-line px-3 py-1 aria-pressed:font-semibold">English</button>
        <button type="button" disabled={pending} aria-pressed={language === "es"}
          onClick={() => choose("es")} className="rounded border border-line px-3 py-1 aria-pressed:font-semibold">Español</button>
      </div>
      <p className="mt-2 text-xs text-ink-soft">
        Spanish contract and message translations require independent review before use.
        / Las traducciones requieren revisión antes de usarse.
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
