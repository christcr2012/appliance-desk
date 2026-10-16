"use client";
import { useCustomerTranslation, useCustomerLanguage } from "@/domains/language/client-portal";
import { useState, useTransition } from "react";
import { submitTenantRepairAction } from "./actions";
export function TenantRepairForm({ token, appliances }: {
  token: string; appliances: { id: string; label: string }[];
}) {
  const t=useCustomerTranslation();
  const language=useCustomerLanguage();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  if (done) return <p role="status" className="rounded border border-line p-4">{t("Repair reported to the property client. Please contact them for updates.")}</p>;
  return <form className="space-y-4" onSubmit={e => {
    e.preventDefault(); const form = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await submitTenantRepairAction(token, {
        applianceId: String(form.get("applianceId") ?? ""),
        problem: String(form.get("problem") ?? ""),
      });
      if (result.ok) setDone(true);
      else setError(result.message);
    });
  }}>
    <label className="block text-sm">{t("Appliance")}
      <select name="applianceId" required className="mt-1 block w-full rounded border border-line p-2">
        <option value="">{t("Choose your appliance")}</option>
        {appliances.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
      </select>
    </label>
    {!appliances.length && <p>{t("No active appliances are available for reporting. Please contact the property client.")}</p>}
    <label className="block text-sm">{t("Describe the issue")}
      <textarea name="problem" required minLength={10} maxLength={2000} rows={5}
        className="mt-1 block w-full rounded border border-line p-2" />
    </label>
    <p className="text-sm text-ink-soft">{t("This only requests service. It does not authorize fees or send automated text messages.")}</p>
    <button disabled={pending || !appliances.length}
      className="rounded bg-action px-4 py-2 text-on-action disabled:opacity-50">
      {pending ? t("Submitting…") : t("Send repair report")}</button>
    {error && <p role="alert" className="text-red-700">{language==="es"?t("Your request could not be completed. Try again or contact the business."):error}</p>}
  </form>;
}
