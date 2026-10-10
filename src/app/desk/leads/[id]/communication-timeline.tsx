import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatBusinessDate,formatBusinessTime } from "@/lib/business-date";
import { getLinkedCommunicationRows } from "@/domains/messaging/context-timeline";
import { mergeTimelinePage,readTimelineCursor,timelineCursorWhere } from "@/domains/customers/timeline-page";

export async function LeadCommunicationTimeline({
  leadId,cursorToken,
}:{leadId:string;cursorToken?:string}) {
  const cursor=readTimelineCursor(cursorToken);
  const [notes,comm]=await Promise.all([
    prisma.leadNote.findMany({
      where:{leadId,...timelineCursorWhere("note",cursor)},
      take:26,orderBy:[{createdAt:"desc"},{id:"desc"}],
      select:{id:true,body:true,createdAt:true,author:{select:{name:true,email:true}}},
    }),
    getLinkedCommunicationRows("Lead",leadId,cursor),
  ]);
  const feed=mergeTimelinePage(notes.map(n=>({
    id:"note-"+n.id,kind:"note" as const,summary:"Internal lead note",detail:n.body,
    authorName:n.author?.name??n.author?.email??null,createdAt:n.createdAt,href:null,
  })),[],comm.messages,comm.calls);
  return <section aria-labelledby="lead-conversation-heading"
    className="mt-6 rounded-lg border border-line bg-surface p-5">
    <h2 id="lead-conversation-heading" className="font-semibold">
      Lead notes, texts and calls
    </h2>
    <p className="mt-1 text-xs text-ink-faint">
      Private owner/admin history. Only confirmed links are shown; shared phone numbers are not
      proof of identity. Provider acceptance does not mean a text was delivered.
    </p>
    <ul className="mt-3 divide-y divide-line">
      {feed.entries.map(item=><li key={item.id} className="py-3 text-sm">
        <p className="font-medium">{item.href
          ? <Link href={item.href} className="underline">{item.summary}</Link>
          : item.summary}</p>
        {item.detail && <p className="mt-1 break-words text-ink-soft">{item.detail}</p>}
        <time className="text-xs text-ink-faint" dateTime={item.createdAt.toISOString()}>
          {formatBusinessDate(item.createdAt)} · {formatBusinessTime(item.createdAt)}
          {item.authorName ? " · Logged by " + item.authorName : ""}
        </time>
      </li>)}
    </ul>
    {feed.entries.length===0 && <p className="mt-3 text-sm text-ink-soft">
      No confirmed communication activity or notes on this page.
    </p>}
    <nav className="mt-3 flex gap-4 text-sm" aria-label="Lead communications history pages">
      {cursorToken && <Link href={"/desk/leads/"+encodeURIComponent(leadId)}
        className="underline">Newest records</Link>}
      {feed.nextCursor && <Link className="underline"
        href={"/desk/leads/"+encodeURIComponent(leadId)+"?commsCursor="+encodeURIComponent(feed.nextCursor)}>
          Older records
      </Link>}
    </nav>
  </section>;
}
