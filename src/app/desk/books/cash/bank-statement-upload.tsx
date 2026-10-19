"use client";
import { useState } from "react";
import { PhotoUploadField } from "@/components/photo-upload-field";

export function BankStatementUpload({importId,accountId,onAttach}:{
 importId:string;accountId:string;onAttach:(form:FormData)=>Promise<void>;
}){
 const [url,setUrl]=useState(""),[error,setError]=useState("");
 return <form action={onAttach} className="space-y-2">
  <input type="hidden" name="importId" value={importId}/>
  <input type="hidden" name="url" value={url}/>
  <PhotoUploadField pathPrefix={`bank-statements/${accountId}`} access="private"
   label="Upload private statement" accept="application/pdf,image/jpeg,image/png,image/webp"
   onUploaded={storageUrl=>{setUrl(storageUrl);setError("");}} onError={setError}/>
  {error&&<p role="alert" className="text-destructive">{error}</p>}
  {url&&<button type="submit" className="rounded border border-border px-3 py-2 font-medium focus-visible:outline-2">Attach to this archived import</button>}
 </form>;
}
