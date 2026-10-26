import { InfoTip } from "@/components/ui/info-tip";
import { fileAndPayLine, type FileAndPayInput } from "@/domains/tax/file-and-pay";

/** The first thing on every return page: what to file, how much to pay, where and by when. */
export function FileAndPayHeadline(props: FileAndPayInput) {
  const line = fileAndPayLine(props);
  return (
    <section aria-label="File and pay" className={`space-y-2 rounded-lg border p-4 ${line.overdue ? "border-destructive" : "border-border"} bg-card`}>
      <p className="text-base font-semibold">
        {line.headline} <InfoTip term="suts" />
      </p>
      {line.actOn && <p className="text-sm font-medium">{line.actOn}</p>}
      {line.parts.length > 0 && (
        <ul className="text-sm text-muted-foreground">
          {line.parts.map((part) => <li key={part.label}>{part.label}: {part.amount}</li>)}
        </ul>
      )}
      {line.link && (
        <a href={line.link.href} target="_blank" rel="noopener noreferrer" className="inline-block rounded-lg border border-border px-3 py-2 text-sm font-medium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          {line.link.label}
        </a>
      )}
      <p className="text-xs text-muted-foreground">Appliance Desk never files a return or pays tax for you. You file and pay on the official website, then record it below.</p>
    </section>
  );
}
