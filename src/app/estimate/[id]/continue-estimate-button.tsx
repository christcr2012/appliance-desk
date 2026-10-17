"use client";
import { portalLabel } from "@/domains/language/portal-copy";
import type { CustomerLanguage } from "@/domains/language/copy";
import { useState,useTransition } from "react";
import { continueEstimateOrderAction } from "./actions";
export function ContinueEstimateOrderButton({estimateId, language = "en"}:{estimateId:string;language?:CustomerLanguage}) {
  const t = (word: Parameters<typeof portalLabel>[1]) => portalLabel(language, word);
  const [pending,start]=useTransition();
  const [message,setMessage]=useState("");
  return <div className="space-y-2">
    <button type="button" disabled={pending}
      onClick={()=>start(async()=>{
        const result=await continueEstimateOrderAction(estimateId);
        if(result.state==="SIGN") window.location.assign(result.path);
        else setMessage(result.state==="WAITING"?t("Your estimate is not yet accepted."):
          t("This offer needs owner review before signing. No delivery is booked or payment taken."));
      })}
      className="rounded bg-action px-3 py-2 text-sm text-on-action disabled:opacity-50">
      {pending?t("Reviewing your prepared order…"):t("Continue to your agreement")}
    </button>
    {message&&<p role="status" className="text-sm text-ink-soft">{message}</p>}
  </div>;
}
