"use client";
import { useState } from "react";
/** No receipt is an explicit person-attested statement, never a fake upload. */
export function NoReceiptFields(){
 const [missing,setMissing]=useState(false);
 return <div className="sm:col-span-2 space-y-2">
  <label className="inline-flex min-h-11 items-center gap-2">
   <input type="checkbox" name="noReceipt" checked={missing}
    onChange={e=>setMissing(e.target.checked)}/>
   No receipt for this one
  </label>
  {missing&&<label className="block">
    Why was there no receipt?
    <input name="noReceiptReason" required maxLength={200}
     className="min-h-11 w-full rounded border border-border bg-background px-3 py-2"
     placeholder="Explain how the amount was confirmed"/>
   </label>}
 </div>;
}
