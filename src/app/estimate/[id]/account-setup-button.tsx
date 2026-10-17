"use client";
import { portalLabel } from "@/domains/language/portal-copy";
import type { CustomerLanguage } from "@/domains/language/copy";
import {useState,useTransition} from "react";
import {sendFinishedOrderActivationAction} from "./account-actions";
export function OrderAccountSetupButton({estimateId, language = "en"}:{estimateId:string;language?:CustomerLanguage}) {
  const t = (word: Parameters<typeof portalLabel>[1]) => portalLabel(language, word);
  const [busy,start]=useTransition();
  const [status,setStatus]=useState("");
  return <div className="space-y-2">
    <button type="button" disabled={busy} className="rounded border border-line p-2"
      onClick={()=>start(async()=>{
        const result=await sendFinishedOrderActivationAction(estimateId);
        setStatus(language === "es" ? t("If the request is eligible, a secure account link will be sent to the verified address.") : result.message);
      })}>{t("Send secure account password link")}</button>
    <p className="text-xs text-ink-soft">{t("For security, your password is created on our secure one-use email link. We never accept passwords from an unverified shared estimate link.")}</p>
    {status&&<p role="status">{status}</p>}
  </div>;
}
