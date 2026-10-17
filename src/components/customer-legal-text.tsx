import type { CustomerLanguage } from "@/domains/language/copy";
import { portalLabel } from "@/domains/language/portal-copy";
/** Preserve recorded English verbatim, with separately reviewed informational Spanish beside it. */
export function CustomerLegalText({english,spanish,language}:{english:string;spanish?:string;language:CustomerLanguage}) {
  return <div className="space-y-2 text-sm">
    {language === "es" && spanish && <p lang="es" className="whitespace-pre-line">{spanish}</p>}
    {language === "es" && <p lang="es" className="font-medium">{portalLabel(language,"The recorded English terms below control this agreement.")}</p>}
    <p lang="en" className="whitespace-pre-line text-ink-soft">{english}</p>
  </div>;
}
