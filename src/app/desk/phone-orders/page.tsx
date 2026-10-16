import Link from "next/link";
import {requireRole} from "@/lib/session";
import {listPhoneOrders} from "@/domains/orders/phone-orders";
export const metadata={title:"Phone orders"};
export default async function PhoneOrdersPage(){
  const session=await requireRole("OWNER","ADMIN");
  const rows=await listPhoneOrders(session.user.id);
  return <main className="space-y-5">
    <div className="flex flex-wrap justify-between gap-3">
      <div><h1 className="text-xl font-semibold">Phone orders</h1>
        <p className="text-sm text-ink-soft">Owner-entered requests; customers
          still accept, sign and pay on their own secure page.</p></div>
      <Link href="/desk/phone-orders/new" className="rounded bg-action px-3 py-2 text-on-action">
        Start phone order</Link>
    </div>
    <p className="text-sm text-ink-soft">No phone recording, verbal approval,
      card capture or automatically sent text messages.</p>
    <ul className="space-y-2">
      {rows.map(row=><li key={row.id} className="flex flex-wrap gap-2 rounded border border-line p-3">
        <Link href={"/desk/estimates/"+row.id} className="font-semibold underline">
          {row.title}</Link>
        <span className="text-sm">{row.customer?.user.name??row.customer?.user.email??
          row.lead?.contactName??"New caller"} · {row.status}</span>
        <span className="text-xs text-ink-soft">Entered {row.phoneEnteredAt?.toLocaleDateString("en-US")}
          {" "}· staff ID {row.createdByUserId.slice(0,8)}</span>
      </li>)}
      {rows.length===0&&<li className="text-sm text-ink-soft">No phone orders yet.</li>}
    </ul>
  </main>;
}
