import Link from "next/link";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { getContextEvidence, type ContextKind } from "@/domains/messaging/context-evidence";
export async function ContextCommunicationPanel({kind,id}:{kind:ContextKind;id:string}){
 const facts=await getContextEvidence(kind,id);
 if(facts.restricted) return null;
 return <section className="mt-6 rounded-lg border border-line bg-surface p-4">
  <h2 className="font-semibold">Related communications</h2>
  <p className="mt-1 text-xs text-ink-faint">
   Only notifications explicitly attached to this record are shown.
   A shared phone number is not evidence of identity.
   Provider acceptance is not proof of delivery.
  </p>
  {facts.entries.length===0
   ?<p className="mt-3 text-sm text-ink-soft">No linked communications recorded.</p>
   :<ul className="mt-3 divide-y divide-line">{facts.entries.map(e=>
    <li key={e.id} className="py-3 text-sm">
     <p className="font-medium">{e.direction==="INBOUND"?"Incoming":"Outgoing"} {e.channel.toLowerCase()}</p>
     <p className="text-ink-soft">{e.status}</p>
     <p className="mt-1 text-xs text-ink-faint">
      {formatBusinessDate(e.at)} at {formatBusinessTime(e.at)}
      {e.href ? <Link href={e.href} className="ml-2 underline">Open private conversation</Link> : null}
     </p>
    </li>)}</ul>}
  {facts.truncated&&<p className="mt-2 text-xs text-ink-faint">
   Showing recent linked evidence only; older records may exist.
  </p>}
 </section>;
}
