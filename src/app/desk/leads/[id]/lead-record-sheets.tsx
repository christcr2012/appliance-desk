"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, Sheet, toast } from "@/components/kit";
import type { ConfirmSpec } from "@/components/kit";
import { mergeLeadsAction, updateLeadDetailsAction } from "../actions";
import type { LeadDetailsInput } from "@/domains/leads";

const inputClass =
  "min-h-11 w-full rounded-field border border-line bg-surface px-3 text-[15px] text-ink";
const labelClass = "mb-1 block text-sm font-semibold text-ink";
const saveClass =
  "inline-flex min-h-11 items-center rounded-field bg-primary px-4 text-[15px] font-bold text-on-primary disabled:opacity-60";

/** A URL-driven sheet wrapping a server-rendered panel (text / call log). */
export function PanelSheet({
  title,
  closeHref,
  children,
}: {
  title: string;
  closeHref: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <Sheet open onOpenChange={(o) => !o && router.push(closeHref, { scroll: false })} title={title}>
      {children}
    </Sheet>
  );
}

export type LeadDetailsDefaults = LeadDetailsInput;

/** AR-4b (LEADS.md 3.5/3.7): the "What they want" edit sheet. */
export function LeadDetailsSheet({
  leadId,
  defaults,
  closeHref,
}: {
  leadId: string;
  defaults: LeadDetailsDefaults;
  closeHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState(defaults);
  const close = () => router.push(closeHref, { scroll: false });
  const set = <K extends keyof LeadDetailsInput>(key: K, value: LeadDetailsInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = () =>
    startTransition(async () => {
      const r = await updateLeadDetailsAction(leadId, form);
      if (r.status === "error") {
        toast({ message: r.message, tone: "danger" });
        return;
      }
      toast({ message: "Saved" });
      close();
      router.refresh();
    });

  return (
    <Sheet open onOpenChange={(o) => !o && close()} title="What they want" footer={
      <button type="button" className={saveClass} disabled={pending} onClick={submit}>
        {pending ? "Saving…" : "Save"}
      </button>
    }>
      <div className="space-y-4">
        <div>
          <label className={labelClass} htmlFor="ld-name">Name</label>
          <input id="ld-name" className={inputClass} value={form.contactName} onChange={(e) => set("contactName", e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor="ld-company">Company</label>
          <input id="ld-company" className={inputClass} value={form.companyName ?? ""} onChange={(e) => set("companyName", e.target.value)} />
        </div>
        <div className="flex gap-6">
          <label className="flex items-center gap-2 text-[15px] text-ink">
            <input type="checkbox" checked={form.isBusiness} onChange={(e) => set("isBusiness", e.target.checked)} />
            Business
          </label>
          <label className="flex items-center gap-2 text-[15px] text-ink">
            <input type="checkbox" checked={form.isPropertyManager} onChange={(e) => set("isPropertyManager", e.target.checked)} />
            Property manager
          </label>
        </div>
        <div>
          <label className={labelClass} htmlFor="ld-phone">Phone</label>
          <input id="ld-phone" className={inputClass} value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor="ld-email">Email</label>
          <input id="ld-email" className={inputClass} value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor="ld-best-time">Best time to contact</label>
          <input id="ld-best-time" className={inputClass} value={form.bestTimeToContact ?? ""} onChange={(e) => set("bestTimeToContact", e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor="ld-heard">How they heard about us</label>
          <input id="ld-heard" className={inputClass} value={form.howHeard ?? ""} onChange={(e) => set("howHeard", e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor="ld-term">Desired term</label>
          <select id="ld-term" className={inputClass} value={form.desiredTerm ?? ""} onChange={(e) => set("desiredTerm", (e.target.value || null) as LeadDetailsInput["desiredTerm"])}>
            <option value="">Not sure yet</option>
            <option value="month-to-month">Month to month</option>
            <option value="6-month">6 months</option>
            <option value="12-month">12 months</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="ld-start">Desired start date</label>
          <input id="ld-start" type="date" className={inputClass} value={form.desiredStartDate ?? ""} onChange={(e) => set("desiredStartDate", e.target.value || null)} />
        </div>
        <div>
          <label className={labelClass} htmlFor="ld-qty">How many</label>
          <input id="ld-qty" type="number" min={1} max={50} className={inputClass} value={form.quantity} onChange={(e) => set("quantity", Number(e.target.value))} />
        </div>
        <div>
          <label className={labelClass} htmlFor="ld-address">Address</label>
          <input id="ld-address" className={inputClass} value={form.addressLine1 ?? ""} onChange={(e) => set("addressLine1", e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="ld-city">City</label>
            <input id="ld-city" className={inputClass} value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="ld-zip">ZIP</label>
            <input id="ld-zip" className={inputClass} value={form.zip ?? ""} onChange={(e) => set("zip", e.target.value)} />
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor="ld-notes">Notes from the lead</label>
          <textarea id="ld-notes" rows={3} className={inputClass} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
        </div>
        <p className="text-sm text-ink-soft">
          Appliances are edited in the quote — a quote for this lead lists exactly what they&apos;ll rent.
        </p>
      </div>
    </Sheet>
  );
}

export type MergeLeadSummary = {
  id: string;
  contactName: string;
  phone: string;
  email: string | null;
  createdLabel: string;
  wants: string;
};

/** AR-4b (LEADS.md 3.4): compare the two leads, pick the keeper, confirm. */
export function LeadMergeSheet({
  current,
  other,
  defaultKeepId,
  closeHref,
}: {
  current: MergeLeadSummary;
  other: MergeLeadSummary;
  defaultKeepId: string;
  closeHref: string;
}) {
  const router = useRouter();
  const [keepId, setKeepId] = useState(defaultKeepId);
  const [confirming, setConfirming] = useState(false);
  const close = () => router.push(closeHref, { scroll: false });

  const rows: [string, (l: MergeLeadSummary) => string][] = [
    ["Name", (l) => l.contactName],
    ["Phone", (l) => l.phone],
    ["Email", (l) => l.email ?? "—"],
    ["Came in", (l) => l.createdLabel],
    ["Wants", (l) => l.wants || "—"],
  ];

  const spec: ConfirmSpec = {
    title: "Merge these leads?",
    summary:
      "Everything moves to the kept lead — quotes, notes, tasks and history. The other lead closes as merged.",
    confirmLabel: "Merge leads",
    danger: true,
  };

  return (
    <Sheet open onOpenChange={(o) => !o && close()} title="Possible duplicate" footer={
      <button type="button" className={saveClass} onClick={() => setConfirming(true)}>
        Continue
      </button>
    }>
      <table className="w-full text-[15px]">
        <tbody>
          {rows.map(([label, get]) => (
            <tr key={label} className="border-b border-line last:border-0">
              <th className="py-2 pr-2 text-left align-top font-semibold text-ink-soft">{label}</th>
              <td className="py-2 pr-2 text-ink">{get(current)}</td>
              <td className="py-2 text-ink">{get(other)}</td>
            </tr>
          ))}
          <tr>
            <th className="py-2 pr-2 text-left font-semibold text-ink-soft">Keep</th>
            {[current, other].map((l) => (
              <td key={l.id} className="py-2 pr-2">
                <label className="flex items-center gap-2 text-ink">
                  <input
                    type="radio"
                    name="keep-lead"
                    checked={keepId === l.id}
                    onChange={() => setKeepId(l.id)}
                  />
                  Keep this one
                </label>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(o) => !o && setConfirming(false)}
        spec={spec}
        onConfirm={async () => {
          const mergeId = keepId === current.id ? other.id : current.id;
          const r = await mergeLeadsAction(keepId, mergeId);
          if (r && r.status === "error") {
            toast({ message: r.message, tone: "danger" });
            setConfirming(false);
          }
          // On success the action redirects to the kept lead.
        }}
      />
    </Sheet>
  );
}
