import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getMonthEndReviewById } from "@/domains/budget/published";
import { formatMoney } from "@/lib/money-ui";
export const metadata={title:"Saved month-end review — Books"};
export default async function MonthReviewDetailPage({params}:{params:Promise<{id:string}>}){
 const session=await requireRole("OWNER","ADMIN");
 const {id}=await params;
 const report=await getMonthEndReviewById(session.user.id,id);
 const snapshot=report.content;
 return <div className="space-y-4">
  <Link href={"/desk/books/budget?tab=review&month="+report.month} className="underline">Back to monthly reviews</Link>
  <h1 className="text-2xl font-bold">Saved month-end evidence — {report.month}</h1>
  <p>This historical snapshot is immutable and dated {report.createdAt}; SHA-256 {report.sha256}.
   {report.stale?" Source revisions have since changed: this is not current accounting evidence.":" Source revisions are unchanged."}</p>
  <p>Owner notes: {snapshot.reason}. Published plan version: {snapshot.planVersion??"Unplanned"}.
   Banking/cash and books evidence was copied on the date of review; this record does not close the books.</p>
  <section className="rounded border border-border p-4 space-y-3">
   <h2 className="font-semibold text-lg">Original stored totals</h2>
   <p>Recognized revenue {formatMoney(snapshot.profit.revenueCents)}, expenses {formatMoney(snapshot.profit.costCents)},
    management profit {formatMoney(snapshot.profit.netProfitCents)}.</p>
   <p>Bank movement {snapshot.cash.netCents===null?"Unknown":formatMoney(snapshot.cash.netCents)}; unclassified expense funding {formatMoney(snapshot.unclassifiedCents)}.</p>
  </section>
  <section className="rounded border border-border p-4 space-y-3">
   <h2 className="font-semibold text-lg">Original review checks</h2>
   <ul className="list-disc pl-6">{snapshot.checklist.map(x=><li key={x.key}>
    {x.ok?"Checked":"Incomplete"} — {x.label}{x.reason?": "+x.reason:""}
   </li>)}</ul>
   <p>{snapshot.allMonthEndReady?"Software checks satisfied when captured":"Incomplete when captured"}; independent owner and CPA release checks remain separate.</p>
  </section>
 </div>;
}
