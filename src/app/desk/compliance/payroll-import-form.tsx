"use client";

import { useActionState } from "react";
import { importPayrollAction, type ComplianceActionState } from "./actions";

const inputCls = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm";

/** CMP-5: the payroll provider CSV upload (summary totals only). */
export function PayrollImportForm() {
  const [state, formAction, pending] = useActionState<ComplianceActionState, FormData>(
    importPayrollAction,
    {},
  );
  return (
    <form action={formAction} className="space-y-3">
      {state.error ? (
        <p role="alert" className="rounded-card bg-danger-tint px-4 py-3 text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p className="rounded-card bg-tint px-4 py-3 text-sm font-medium text-ink">
          {state.message ?? "Imported."}
        </p>
      ) : null}
      <div>
        <label className="block text-sm font-medium text-ink" htmlFor="payrollCsv">
          Payroll summary CSV
        </label>
        <input id="payrollCsv" name="payrollCsv" type="file" accept=".csv,text/csv" className={inputCls} />
        <p className="mt-1 text-sm text-ink-soft">
          One row per pay run with the columns pay_date, gross_wages, employer_taxes and amount_withdrawn
          (employee_taxes and provider are optional). Each pay run posts to the books as wages and payroll
          taxes against the bank withdrawal. Summary totals only — never upload a file with employee names
          or Social Security numbers.
        </p>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-action bg-action px-3 py-2 text-sm font-medium text-on-action disabled:opacity-60"
      >
        {pending ? "Importing…" : "Import pay runs"}
      </button>
    </form>
  );
}
