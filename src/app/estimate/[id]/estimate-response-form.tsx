"use client";

import { useEffect, useState, useTransition } from "react";
import { approveEstimateAction, requestEstimateChangesAction, declineEstimateAction, type EstimateResponseState } from "./actions";
import { estimateFormText, type FormCopyKey } from "@/domains/language/estimate-form-copy";
import type { CustomerLanguage } from "@/domains/language/copy";

export function EstimateResponseForm({ estimateId, allowApproval = false,
  expectedQuoteFingerprint, deliveryOptions = [], offerVersion = 0,
  phonePrefill = null, language = "en" }: {
  estimateId: string; language?: CustomerLanguage; allowApproval?: boolean; expectedQuoteFingerprint?: string | null;
  deliveryOptions?: Array<{id:string;date:string;window:"AM"|"PM"}>;
  offerVersion?:number;
  phonePrefill?:import("@/domains/orders/delivery").DeliverySelection|null;
}) {
  const [isPending, startTransition] = useTransition();
  const t = (key: FormCopyKey) => estimateFormText(language, key);
  const [mode, setMode] = useState<"choose" | "approve" | "changes" | "decline">("choose");
  const [approverName, setApproverName] = useState("");
  const [approverEmail, setApproverEmail] = useState("");
  const [message, setMessage] = useState("");
  const [chosen, setChosen] = useState(phonePrefill?.optionId??deliveryOptions[0]?.id??"");
  const [dryerOutlet,setDryerOutlet]=useState<"THREE_PRONG"|"FOUR_PRONG"|"GAS"|"UNKNOWN">(phonePrefill?.questions.dryerOutlet??"UNKNOWN");
  const [washerHookups,setWasherHookups]=useState<"YES"|"NO"|"UNKNOWN">(phonePrefill?.questions.washerHookups??"UNKNOWN");
  const [stairs,setStairs]=useState(phonePrefill?.questions.stairs??false);
  const [crewNotes,setCrewNotes]=useState(phonePrefill?.questions.crewNotes??"");
  const [result, setResult] = useState<EstimateResponseState>({ status: "idle" });

  // Send the browser on to Stripe Checkout for the deposit — an effect,
  // not a render-time assignment, since navigating away is a side
  // effect, not something that can happen while rendering.
  useEffect(() => {
    if (result.status === "redirecting") {
      window.location.href = result.url;
    }
  }, [result]);

  if (result.status === "redirecting") {
    return (
      <div className="rounded-lg border border-line bg-surface p-5 text-sm text-ink-soft">
        <p>{t("redirect")}</p>
      </div>
    );
  }
  if (result.status === "approved") {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-5 text-sm text-green-900">
        <p className="font-medium">{t("approved")}</p>
        <p className="mt-1">{t("next")}</p>
      </div>
    );
  }
  if (result.status === "declined") {
    return <p role="status" className="rounded border border-line p-4">{t("declined")}</p>;
  }
  if (result.status === "changes_requested") {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        <p className="font-medium">{t("changes")}</p>
        <p className="mt-1">{t("updated")}</p>
      </div>
    );
  }

  function handleApprove(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      setResult(await approveEstimateAction(estimateId, { approverName, approverEmail, expectedQuoteFingerprint,
        ...(deliveryOptions.length ? { deliverySelection: {
          optionId:chosen,expectedOfferVersion:offerVersion,
          questions:{dryerOutlet,stairs,washerHookups,crewNotes},
        }} : {}),
      }));
    });
  }

  function handleRequestChanges(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      setResult(await requestEstimateChangesAction(estimateId, { message }));
    });
  }

  if (mode === "approve") {
    return (
      <form onSubmit={handleApprove} className="space-y-4 rounded-lg border border-line bg-surface p-5">
        <p className="text-sm text-ink-soft">{t("intro")}</p>
        <div>
          <label htmlFor="approverName" className="block text-sm font-medium text-ink-soft">
            {t("name")}
          </label>
          <input
            id="approverName"
            type="text"
            required
            value={approverName}
            onChange={(e) => setApproverName(e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="approverEmail" className="block text-sm font-medium text-ink-soft">
            {t("email")}
          </label>
          <input
            id="approverEmail"
            type="email"
            required
            value={approverEmail}
            onChange={(e) => setApproverEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>
        {phonePrefill && <p className="text-sm text-ink-soft">
          {t("phone")}
        </p>}
        {deliveryOptions.length > 0 && <fieldset className="space-y-3 rounded border border-line p-3">
          <legend className="font-semibold">{t("delivery")}</legend>
          <label className="block text-sm">{t("chooseWindow")}
            <select required value={chosen} onChange={e=>setChosen(e.target.value)}
              className="mt-1 block w-full rounded border border-line p-2">
              {deliveryOptions.map(option=><option key={option.id} value={option.id}>
                {option.date} · {option.window==="AM"?"Morning":"Afternoon"}
              </option>)}
            </select>
          </label>
          <label className="block text-sm">{t("dryer")}
            <select value={dryerOutlet} onChange={e=>setDryerOutlet(e.target.value as typeof dryerOutlet)}
              className="mt-1 block w-full rounded border border-line p-2">
              <option value="UNKNOWN">{t("unsure")}</option><option value="THREE_PRONG">{t("prong3")}</option>
              <option value="FOUR_PRONG">{t("prong4")}</option><option value="GAS">{t("gas")}</option>
            </select>
          </label>
          <label className="block text-sm">{t("washer")}
            <select value={washerHookups} onChange={e=>setWasherHookups(e.target.value as typeof washerHookups)}
              className="mt-1 block w-full rounded border border-line p-2">
              <option value="UNKNOWN">{t("unsure")}</option><option value="YES">{t("present")}</option>
              <option value="NO">{t("missing")}</option>
            </select>
          </label>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={stairs}
            onChange={e=>setStairs(e.target.checked)}/> {t("stairs")}</label>
          <label className="block text-sm">{t("crew")}
            <textarea value={crewNotes} onChange={e=>setCrewNotes(e.target.value)} maxLength={1500}
              className="mt-1 block w-full rounded border border-line p-2"/>
          </label>
          <p className="text-xs text-ink-soft">{t("requestNotBooked")}</p>
        </fieldset>}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action disabled:opacity-50"
          >
            {isPending ? t("sending") : t("approve")}
          </button>
          <button
            type="button"
            onClick={() => setMode("choose")}
            className="rounded-md border border-line-strong px-4 py-2 text-sm text-ink-soft hover:border-line-strong"
          >
            {t("back")}
          </button>
        </div>
        {result.status === "error" && (
          <p role="alert" className="text-sm text-red-700">
            {result.message}
          </p>
        )}
      </form>
    );
  }

  if(mode==="decline")return <form className="space-y-3 rounded border border-line p-4"
    onSubmit={e=>{e.preventDefault();startTransition(async()=>{
      setResult(await declineEstimateAction(estimateId,{reason:message}));
    });}}>
    <label className="block text-sm">{t("reason")}
      <textarea value={message} onChange={e=>setMessage(e.target.value)} maxLength={1000}
        className="mt-1 block w-full rounded border border-line p-2"/></label>
    <button disabled={isPending} className="rounded bg-action px-3 py-2 text-on-action">{t("decline")}</button>
    {result.status==="error"&&<p role="alert">{result.message}</p>}
  </form>;
  if (mode === "changes") {
    return (
      <form
        onSubmit={handleRequestChanges}
        className="space-y-4 rounded-lg border border-line bg-surface p-5"
      >
        <div>
          <label htmlFor="changes-message" className="block text-sm font-medium text-ink-soft">
            What would you like changed?
          </label>
          <textarea
            id="changes-message"
            required
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action disabled:opacity-50"
          >
            {isPending ? "Sending…" : "Send request"}
          </button>
          <button
            type="button"
            onClick={() => setMode("choose")}
            className="rounded-md border border-line-strong px-4 py-2 text-sm text-ink-soft hover:border-line-strong"
          >
            {t("back")}
          </button>
        </div>
        {result.status === "error" && (
          <p role="alert" className="text-sm text-red-700">
            {result.message}
          </p>
        )}
      </form>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      {allowApproval && <button
        type="button"
        onClick={() => setMode("approve")}
        className="rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action"
      >
        {t("approve")}
      </button>}
      <button type="button" onClick={()=>setMode("decline")}
        className="rounded border border-line p-2">{t("decline")}</button>
      <button
        type="button"
        onClick={() => setMode("changes")}
        className="rounded-md border border-line-strong px-4 py-2 text-sm text-ink-soft hover:border-line-strong"
      >
        {t("request")}
      </button>
    </div>
  );
}
