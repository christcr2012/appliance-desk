import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { saveTaxAccountAction } from "../../actions";
import { TaxActionForm } from "../../forms";
const css="w-full rounded border border-input bg-background p-2 text-sm";
const label="grid gap-1 text-sm font-medium";
export default async function FilingAccountEditor({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  const session=await requireRole("OWNER","ADMIN");
  const account=await prisma.taxFilingAccount.findUnique({where:{id}});
  if(!account) notFound();
  const missing = [
    !account.accountNumber && "Official account/license number",
    !account.firstPeriodStart && "First filing period",
    account.kind !== "RETAIL_DELIVERY_FEE_RETURN" && account.basis === "UNDECIDED" && "CPA-confirmed reporting basis",
  ].filter(Boolean);
  return <main className="max-w-3xl space-y-5">
    <Link href="/desk/sales-tax/setup" className="text-sm underline">Back to tax setup</Link>
    <h2 className="text-xl font-semibold">Filing account: {account.name}</h2>
    {missing.length>0 && <div role="status" className="rounded border border-border p-3 text-sm">
      Setup incomplete: {missing.join("; ")}. Filing is not ready until the missing answers are entered.</div>}
    {session.user.role==="OWNER" ? <TaxActionForm title="Edit filing account" action={saveTaxAccountAction}>
      <input type="hidden" name="id" value={account.id}/>
      <input type="hidden" name="expectedUpdatedAt" value={account.updatedAt.toISOString()}/>
      <label className={label}>Account name<input name="name" required maxLength={100} defaultValue={account.name} className={css}/></label>
      <div className="grid gap-3 md:grid-cols-3">
        <label className={label}>Return kind<select name="kind" defaultValue={account.kind} className={css}>
          <option value="SALES_RETURN">Sales</option><option value="USE_TAX_RETURN">Use tax</option><option value="RETAIL_DELIVERY_FEE_RETURN">Delivery fee</option></select></label>
        <label className={label}>Frequency<select name="frequency" defaultValue={account.frequency} className={css}>
          <option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option><option value="ANNUAL">Annual</option></select></label>
        <label className={label}>Reporting basis<select name="basis" defaultValue={account.basis} className={css}>
          <option value="UNDECIDED">Ask CPA</option><option value="CASH">Cash</option><option value="ACCRUAL">Accrual</option></select></label>
      </div>
      <label className={label}>Account/license number<input name="accountNumber" defaultValue={account.accountNumber??""} className={css}/></label>
      <label className={label}>Official filing HTTPS portal<input name="portalUrl" type="url" defaultValue={account.portalUrl??""} className={css}/></label>
      <div className="grid gap-3 md:grid-cols-3">
        <label className={label}>First period<input name="firstPeriodStart" type="date" defaultValue={account.firstPeriodStart?.toISOString().slice(0,10)??""} className={css}/></label>
        <label className={label}>Due day (following month)<input name="dueDayOfFollowingMonth" type="number" min={1} max={31} defaultValue={account.dueDayOfFollowingMonth} className={css}/></label>
        <label className={label}>Reminder days<input name="reminderDaysBefore" defaultValue={account.reminderDaysBefore.join(",")} className={css}/></label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input name="active" type="checkbox" defaultChecked={account.active}/>Active filing account</label>
      <label className="flex items-center gap-2 text-sm"><input name="emailReminders" type="checkbox" defaultChecked={account.emailReminders}/>Owner email reminders</label>
      <label className={label}>Filing notes<textarea name="filingNotes" maxLength={1000} defaultValue={account.filingNotes??""} className={css}/></label>
    </TaxActionForm> : <div role="status" className="rounded border border-border p-4 text-sm">Read-only. Ask the owner to update this account.</div>}
  </main>;
}

