"use client";
import {useState,useTransition} from "react";
import {sendFinishedOrderActivationAction} from "./account-actions";
export function OrderAccountSetupButton({estimateId}:{estimateId:string}) {
  const [busy,start]=useTransition();
  const [status,setStatus]=useState("");
  return <div className="space-y-2">
    <button type="button" disabled={busy} className="rounded border border-line p-2"
      onClick={()=>start(async()=>{
        const result=await sendFinishedOrderActivationAction(estimateId);
        setStatus(result.message);
      })}>Send secure account password link</button>
    <p className="text-xs text-ink-soft">
      For security, your password is created on our secure one-use email link.
      We never accept passwords from an unverified shared estimate link.
    </p>
    {status&&<p role="status">{status}</p>}
  </div>;
}
