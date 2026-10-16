import Link from "next/link";
import {requireRole} from "@/lib/session";
import {getCustomers} from "@/domains/customers";
import {NewEstimateForm} from "../../estimates/new/new-estimate-form";
export const metadata={title:"New phone order"};
export default async function NewPhoneOrderPage({
  searchParams,
}:{searchParams:Promise<{customerId?:string}>}) {
  await requireRole("OWNER","ADMIN");
  const {customerId}=await searchParams;
  const customers=await getCustomers();
  return <main className="max-w-xl space-y-5">
    <Link href="/desk/phone-orders" className="text-sm underline">← Phone orders</Link>
    <h1 className="text-xl font-semibold">Start phone order</h1>
    <p className="text-sm text-ink-soft">This creates an ordinary estimate draft
      attributed to your staff account. Enter what the caller requests; the
      customer will independently accept the reviewed written terms.</p>
    <NewEstimateForm phoneMode customers={customers.map(c=>({
      id:c.id,name:c.user.name??c.user.email,companyName:c.companyName,
      isPropertyManager:c.isPropertyManager,
    }))} initialCustomerId={customerId}/>
  </main>;
}
