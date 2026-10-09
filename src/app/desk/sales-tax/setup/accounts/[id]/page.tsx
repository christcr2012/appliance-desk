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
  const allAreas = await prisma.taxJurisdiction.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }], take: 100,
    select: {
      id: true, name: true, filingAccountId: true, useTaxFilingAccountId: true,
      filingCode: true, filingOrder: true, serviceFeeMilliPercent: true,
    },
  });
  const areas = allAreas.filter(row => account.kind === "SALES_RETURN"
    ? !row.filingAccountId || row.filingAccountId === account.id
    : account.kind === "USE_TAX_RETURN"
      ? !row.useTaxFilingAccountId || row.useTaxFilingAccountId === account.id : false);
  const mapping = (value: unknown) => JSON.stringify(value ?? {}, null, 2);
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
      <label className={label}>License expiration (used for renewal reminders)
        <input name="licenseExpiresOn" type="date" className={css} defaultValue={account.licenseExpiresOn?.toISOString().slice(0, 10) ?? ""} />
      </label>
      <fieldset className="space-y-3 rounded border border-border p-3">
        <legend className="font-semibold">SUTS portal fields and export capabilities</legend>
        <p className="text-sm text-muted-foreground">Copy labels from your actual SUTS account. Leave an empty JSON object when the wording is not decided. SUTS credentials are never stored here.</p>
        <label className={label}>Screen wording (JSON mapping of screen keys to labels)
          <textarea name="screenLabels" className={css} rows={3} defaultValue={mapping(account.screenLabels)} />
        </label>
        <label className={label}>Deductions (JSON key to label and reportAs: DEDUCTION or LEAVE_OUT_OF_GROSS)
          <textarea name="deductionLabels" className={css} rows={4} defaultValue={mapping(account.deductionLabels)} />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          {([["excelUploadAvailable", "Excel upload"], ["bulkXmlAvailable", "Bulk XML"]] as const).map(([key, label]) =>
            <label key={key} className={css}>{label}
              <select className={css} name={key} defaultValue={account[key] === null ? "unknown" : account[key] ? "yes" : "no"}>
                <option value="unknown">Not confirmed</option><option value="yes">Available</option><option value="no">Not available</option>
              </select>
            </label>)}
        </div>
        <input type="hidden" name="setupCheckedOn" value={account.setupCheckedOn?.toISOString() ?? ""} />
        <p className="text-sm">Last verified against SUTS: {account.setupCheckedOn?.toISOString().slice(0, 10) ?? "Not confirmed"}</p>
        <label className="flex gap-2 text-sm"><input type="checkbox" name="confirmSetupToday" />I checked these details against SUTS today</label>
      </fieldset>
      {account.kind !== "RETAIL_DELIVERY_FEE_RETURN" && <fieldset className="space-y-3 rounded border border-border p-3">
        <legend className="font-semibold">Jurisdictions on this return</legend>
        <p className="text-sm text-muted-foreground">Assign the areas shown on your filing screen and record their exact code, screen order and service-fee rate (milli-percent). Existing filed returns stay frozen; changing their assignments requires a separate review.</p>
        <input name="jurisdictionIdsPresent" type="hidden" value="yes" />
        <div className="space-y-3">{areas.map(row => {
          const assigned = account.kind === "SALES_RETURN"
            ? row.filingAccountId === account.id : row.useTaxFilingAccountId === account.id;
          return <fieldset key={row.id} className="rounded border border-border p-3">
            <legend className="text-sm font-semibold">{row.name}</legend>
            <input type="hidden" name="jurisdictionId" value={row.id} />
            <div className="grid gap-2 md:grid-cols-4">
              <label className={label}>Included on return
                <select className={css} name={`assignment:${row.id}`} defaultValue={assigned ? account.kind === "SALES_RETURN" ? "SALES" : "USE" : "NONE"}>
                  <option value="NONE">Not on return</option><option value={account.kind === "SALES_RETURN" ? "SALES" : "USE"}>Include</option>
                </select>
              </label>
              <label className={label}>SUTS area code<input className={css} name={`code:${row.id}`} maxLength={40} defaultValue={row.filingCode ?? ""} /></label>
              <label className={label}>Screen order<input className={css} type="number" min={0} max={10000} name={`order:${row.id}`} defaultValue={row.filingOrder} /></label>
              <label className={label}>Service fee (milli-percent)<input className={css} type="number" min={0} max={100000} name={`fee:${row.id}`} defaultValue={row.serviceFeeMilliPercent} /></label>
            </div>
          </fieldset>;
        })}</div>
      </fieldset>}
      <label className={label}>Filing notes<textarea name="filingNotes" maxLength={1000} defaultValue={account.filingNotes??""} className={css}/></label>
    </TaxActionForm> : <div role="status" className="rounded border border-border p-4 text-sm">Read-only. Ask the owner to update this account.</div>}
  </main>;
}

