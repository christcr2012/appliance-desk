import Link from "next/link";
import { REVENUE_ONLINE_URL, type FileNowStep } from "@/domains/tax/use-tax-file-now";
import { FilingCopyField } from "../../returns/filing-copy-field";

/** Guided "File now" panel: where to go, what to type in form order, then record it. The app never files or pays. */
export function FileNowPanel({ steps, periodId, filed, formYear }: { steps: FileNowStep[]; periodId: string; filed: boolean; formYear: number | null }) {
  return (
    <section aria-labelledby="file-now-heading" className="print:hidden space-y-3 rounded-md border border-border p-4">
      <h3 id="file-now-heading" className="text-lg font-semibold">File now</h3>
      {filed ? (
        <p className="text-sm">This return is filed and paid. The numbers are kept here for your records.</p>
      ) : (
        <p className="text-sm">
          Open Colorado&apos;s Revenue Online, choose consumer use tax, and type these numbers in this order. They follow the lines of the state&apos;s DR 0252 form.
          You press the final Submit and pay button yourself; this app never files or pays for you.
        </p>
      )}
      <p>
        <a href={REVENUE_ONLINE_URL} target="_blank" rel="noopener noreferrer"
          className="inline-block rounded-md border border-border px-4 py-2 font-medium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          Open Revenue Online (opens in a new tab)
        </a>
      </p>
      <p className="text-sm">
        {formYear !== null ? (
          <>
            <a href={`/desk/sales-tax/use-tax/${periodId}/form`} target="_blank" rel="noopener noreferrer" className="underline">Print the filled-in official form (DR 0252, {formYear})</a>
            {" "}for the paper filing or your records. It fills the State column in whole dollars and leaves your signature, tax ID numbers and address for you. The invoice list is on page 2 for you to attach from the audit pack.
          </>
        ) : (
          <>The official form for this tax year is not loaded yet, so it can&apos;t be printed filled in. The numbers below are the same ones that would go on it.</>
        )}
      </p>
      <ol className="space-y-3">
        {steps.map((step, index) => (
          <li key={step.title}>
            <h4 className="font-medium">{index + 1}. {step.title}</h4>
            {step.items.map((item) => (
              <div key={item.label}>
                <FilingCopyField label={item.label} value={item.value} />
                {item.hint && <p className="pb-1 text-xs text-muted-foreground">{item.hint}</p>}
              </div>
            ))}
          </li>
        ))}
      </ol>
      {!filed && (
        <p className="text-sm">
          When the website shows its confirmation, <Link href={`/desk/sales-tax/returns/${periodId}`} className="underline">record it with &ldquo;I filed and paid it&rdquo;</Link>.
        </p>
      )}
    </section>
  );
}
