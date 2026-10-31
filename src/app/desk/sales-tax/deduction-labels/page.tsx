import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { TaxActionForm } from "../setup/forms";
import { saveDeductionLabelsAction } from "./actions";
import {
  DEDUCTION_BUCKET_KEYS, RESEARCHED_DEDUCTION_DEFAULTS, deductionSourceNote,
  parseDeductionLabels, resolveDeductionLabels,
} from "@/domains/tax/deduction-labels";
import { RecordHeader } from "@/components/kit";

const css = "w-full rounded border border-input bg-background p-2 text-sm";
const label = "grid gap-1 text-sm font-medium";

/**
 * W-12 / IN-44: the one tax setting the owner and the business's
 * accountant share. It deliberately lives outside Sales tax setup (the
 * accountant's deny-by-default allowlist never opens setup); the domain
 * save re-checks the actor, stamps provenance from the saver's role, and
 * audit-logs the per-bucket change.
 */
export default async function DeductionLabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const session = await requireRole("OWNER", "ACCOUNTANT");
  const { account: accountId } = await searchParams;
  const accounts = await prisma.taxFilingAccount.findMany({
    where: { kind: "SALES_RETURN" }, orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
  const account = accountId
    ? await prisma.taxFilingAccount.findUnique({ where: { id: accountId } })
    : accounts.length === 1
      ? await prisma.taxFilingAccount.findUnique({ where: { id: accounts[0]!.id } })
      : null;
  return <div className="max-w-3xl space-y-5">
    <RecordHeader
      back={{ href: "/desk/sales-tax", label: "Back to sales tax" }}
      title="Deduction wording on the sales tax return"
    />
    <p className="text-sm text-muted-foreground">
      When part of a sale is not taxed, Colorado&apos;s return (form DR 0100) counts it in gross
      sales and takes it off under one of these names on Schedule A. Each kind starts with the
      researched wording; save different wording whenever the CPA&apos;s answer or the SUTS
      account says otherwise. The tax owed never depends on this wording.
    </p>
    {session.user.role === "ACCOUNTANT" && <p className="text-sm">
      You are signed in as the business&apos;s accountant. Wording you save is marked as set by
      the accountant, which clears the “CPA confirmation still pending” label for that kind.
      Every save is recorded with your name and the old and new wording.</p>}
    {accounts.length > 1 && <nav className="flex flex-wrap gap-2 text-sm">
      {accounts.map(row => <a key={row.id}
        className={"rounded border border-border px-3 py-1 " + (account?.id === row.id ? "font-semibold" : "underline")}
        href={`/desk/sales-tax/deduction-labels?account=${row.id}`}>{row.name}</a>)}
    </nav>}
    {!account && <div role="status" className="rounded border border-border p-4 text-sm">
      {accounts.length === 0
        ? "There is no sales tax filing account yet. The owner adds it under Sales tax, Setup."
        : "Choose a filing account above."}
    </div>}
    {account && (() => {
      const stored = parseDeductionLabels(account.deductionLabels);
      const resolved = resolveDeductionLabels(account.deductionLabels);
      const keys = [
        ...DEDUCTION_BUCKET_KEYS,
        ...Object.keys(stored).filter(key => !DEDUCTION_BUCKET_KEYS.includes(key)),
      ];
      return <TaxActionForm title={`Deduction wording — ${account.name}`} action={saveDeductionLabelsAction}>
        <input type="hidden" name="accountId" value={account.id} />
        <input type="hidden" name="expectedUpdatedAt" value={account.updatedAt.toISOString()} />
        {keys.map(key => {
          const def = RESEARCHED_DEDUCTION_DEFAULTS[key];
          const effective = resolved[key];
          if (!effective) return null;
          return <fieldset key={key} className="space-y-2 rounded border border-border p-3">
            <legend className="text-sm font-semibold">{def?.bucketName ?? key}</legend>
            {def && <p className="text-sm text-muted-foreground">{def.plainWords}</p>}
            <label className={label}>Wording printed on the return
              <input className={css} name={`deductionLabel:${key}`} maxLength={120} defaultValue={effective.label} />
            </label>
            <label className={label}>How the amount is reported
              <select className={css} name={`deductionReportAs:${key}`} defaultValue={effective.reportAs}>
                <option value="DEDUCTION">Counted in gross sales, then deducted (Schedule A)</option>
                <option value="LEAVE_OUT_OF_GROSS">Left out of gross sales entirely</option>
              </select>
            </label>
            <p className="text-sm">{deductionSourceNote(effective.source)}</p>
            {def && stored[key] && stored[key]!.source !== "RESEARCHED_DEFAULT" && <p className="text-sm text-muted-foreground">
              Researched wording: {def.label} (Schedule A {def.scheduleLine}, confidence {def.confidence === "HIGH" ? "high" : "medium"}).</p>}
            {def && <label className="flex gap-2 text-sm"><input type="checkbox" name={`deductionRestore:${key}`} />Restore the researched wording for this kind</label>}
          </fieldset>;
        })}
      </TaxActionForm>;
    })()}
  </div>;
}
