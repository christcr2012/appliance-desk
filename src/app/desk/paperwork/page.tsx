import Link from "next/link";
import { requireRole } from "@/lib/session";
import { listRecords, getPaperworkAdminKinds, recommendedAdminKinds } from "@/domains/paperwork/records";
import {
  PAPERWORK_GROUPS,
  PAPERWORK_STATUS_LABEL,
  RECORD_KINDS,
  RECORD_KIND_LABEL,
  maskReference,
  reminderState,
  type PaperworkStatusValue,
} from "@/domains/paperwork/rules";
import { businessDateKey } from "@/lib/business-date";
import { Button, ButtonLink, Card, EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { addStarterChecklistAction } from "./actions";
import { updateAdminKindsAction } from "./record-actions";
import { ExportPicker } from "./export-picker";

export const metadata = { title: "Business records" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "needs-you", label: "Needs you" },
  { key: "all", label: "All" },
  { key: "coming-up", label: "Coming up" },
  { key: "files", label: "Files" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function dueText(state: ReturnType<typeof reminderState>, date: Date | null, isExpiry: boolean) {
  if (!date) return "No date set";
  const day = businessDateKey(date);
  const word = isExpiry ? "Expires" : "Due";
  if (state.kind === "overdue") return `${isExpiry ? "Expired" : "Overdue"} by ${state.daysOver} ${state.daysOver === 1 ? "day" : "days"} (${day})`;
  if (state.kind === "none") return `${word}: ${day}`;
  if (state.daysLeft === 0) return `${word} today (${day})`;
  return `${word} ${day} (in ${state.daysLeft} ${state.daysLeft === 1 ? "day" : "days"})`;
}

function matchesSearch(
  record: { title: string; agency: string | null; kindLabel: string; files: { fileName: string; label: string | null }[] },
  q: string,
): boolean {
  const needle = q.toLowerCase();
  if (record.title.toLowerCase().includes(needle)) return true;
  if (record.agency?.toLowerCase().includes(needle)) return true;
  if (record.kindLabel.toLowerCase().includes(needle)) return true;
  return record.files.some(
    (f) => f.fileName.toLowerCase().includes(needle) || (f.label?.toLowerCase().includes(needle) ?? false),
  );
}

export default async function PaperworkPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "ACCOUNTANT");
  const isOwner = session.user.role === "OWNER";
  const isAccountant = session.user.role === "ACCOUNTANT";
  const { tab: tabParam, q } = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "needs-you";
  const query = (q ?? "").trim();
  const all = await listRecords(session.user.role);
  const records = query ? all.filter((r) => matchesSearch(r, query)) : all;
  const now = new Date();
  const withState = records.map((record) => ({
    record,
    state: reminderState(
      { status: record.status as PaperworkStatusValue, dueOn: record.effectiveDate, remindDaysBefore: record.remindDaysBefore },
      now,
    ),
    isExpiry:
      record.expiresOn != null &&
      record.effectiveDate?.getTime() === record.expiresOn.getTime() &&
      record.dueOn?.getTime() !== record.expiresOn?.getTime(),
  }));
  const needsAttention = withState.filter(({ state }) => state.kind === "overdue" || state.kind === "due_soon");
  const setupLeft = withState.filter(
    ({ record }) =>
      record.templateKey && !record.effectiveDate && (record.status === "TO_DO" || record.status === "IN_PROGRESS"),
  );
  const adminKinds = isOwner ? await getPaperworkAdminKinds() : [];
  const recommended = recommendedAdminKinds();

  const recordRow = ({ record, state, isExpiry }: (typeof withState)[number]) => (
    <li key={record.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <Link href={`/desk/paperwork/${record.id}`} className="font-semibold text-action underline">
          {record.title}
        </Link>
        <p className="text-sm text-ink-soft">
          <span className="mr-2 inline-block rounded bg-accent px-1.5 py-0.5 text-xs font-semibold">{record.kindLabel}</span>
          {record.status === "NOT_NEEDED" ? "Not needed / archived" : dueText(state, record.effectiveDate, isExpiry)}
          {record.hasNumber ? ` · ${record.numberLabel ?? "Number"} ••••${record.numberLast4 ?? ""}` : ""}
          {!record.hasNumber && record.referenceNumber ? ` · Number ${maskReference(record.referenceNumber)}` : ""}
          {record.files.length > 0 ? ` · ${record.files.length} file${record.files.length === 1 ? "" : "s"}` : ""}
        </p>
      </div>
      <StatusPill
        tone={record.status === "DONE" ? "success" : record.status === "IN_PROGRESS" ? "progress" : record.status === "NOT_NEEDED" ? "stopped" : "pending"}
        label={PAPERWORK_STATUS_LABEL[record.status as PaperworkStatusValue]}
      />
    </li>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Business records"
        description={
          isOwner
            ? "Your LLC papers, licenses, tax accounts, insurance, contracts and the files behind them — with the numbers stored encrypted and shown only to you, masked. Add a date and you'll get a reminder on your Today list."
            : isAccountant
              ? "The records the owner has shared with you. Stored numbers are never shown here — you see only that a number is on file. You can add files to a shared record; everything else stays with the owner."
              : "The business records the owner shares with admins. Records holding a stored number, and the numbers themselves, are owner-only."
        }
        primaryAction={isOwner ? <ButtonLink href="/desk/paperwork/new">Add a record</ButtonLink> : undefined}
      />

      <nav className="flex flex-wrap gap-2" aria-label="Record views">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/desk/paperwork?tab=${t.key}${query ? `&q=${encodeURIComponent(query)}` : ""}`}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${tab === t.key ? "bg-action text-on-action" : "border border-border bg-card text-ink hover:bg-accent"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <form method="get" className="flex max-w-md gap-2">
        <input type="hidden" name="tab" value={tab} />
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search titles, agencies, file names…"
          className="w-full rounded border border-line px-3 py-2 text-sm"
          aria-label="Search records"
        />
        <Button type="submit" variant="secondary">Search</Button>
      </form>

      {all.length === 0 && !query ? (
        <EmptyState
          title="Nothing here yet"
          description="Start with the starter records for a new Colorado rental business: the LLC papers, EIN letter, licenses, tax accounts, insurance and contracts. You can change, skip or add to any of it. The list doesn't state any fees or deadlines; you enter the dates from your own papers."
          action={
            isOwner ? (
              <form action={addStarterChecklistAction}>
                <Button type="submit">Set up my starter records</Button>
              </form>
            ) : undefined
          }
        />
      ) : tab === "needs-you" ? (
        <>
          {needsAttention.length > 0 ? (
            <Card title="Needs your attention" description="Due soon or already past due.">
              <ul className="divide-y divide-line">{needsAttention.map(recordRow)}</ul>
            </Card>
          ) : (
            <Card title="Nothing needs you right now">
              <p className="text-sm text-ink-soft">Nothing is due soon or overdue. Anything coming up appears here inside its reminder window.</p>
            </Card>
          )}
          {setupLeft.length > 0 && (
            <p className="text-sm text-ink-soft">
              {setupLeft.length} setup {setupLeft.length === 1 ? "record is" : "records are"} still to do — they&apos;re in the All tab. Open one, fill in what you know, and mark where you are with it.
            </p>
          )}
        </>
      ) : tab === "coming-up" ? (
        <Card title="Coming up (next 12 months)">
          {(() => {
            const horizon = new Date(now);
            horizon.setMonth(horizon.getMonth() + 12);
            const upcoming = withState
              .filter(({ record }) => record.effectiveDate && record.effectiveDate <= horizon && record.status !== "NOT_NEEDED")
              .sort((a, b) => (a.record.effectiveDate?.getTime() ?? 0) - (b.record.effectiveDate?.getTime() ?? 0));
            return upcoming.length > 0 ? (
              <ul className="divide-y divide-line">{upcoming.map(recordRow)}</ul>
            ) : (
              <p className="text-sm text-ink-soft">Nothing with a date in the next 12 months.</p>
            );
          })()}
        </Card>
      ) : tab === "files" ? (
        <Card title="All files">
          {(() => {
            const withFiles = records.filter((r) => r.files.length > 0);
            return withFiles.length > 0 ? (
              <ul className="divide-y divide-line">
                {withFiles.flatMap((record) =>
                  record.files.map((file) => (
                    <li key={file.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <a href={`/api/records/files/${file.id}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-action underline">
                          {file.label || file.fileName}
                        </a>
                        <p className="text-sm text-ink-soft">
                          On <Link href={`/desk/paperwork/${record.id}`} className="underline">{record.title}</Link> · {(file.sizeBytes / 1024).toFixed(0)} KB · added {businessDateKey(file.uploadedAt)}
                        </p>
                      </div>
                    </li>
                  )),
                )}
              </ul>
            ) : (
              <p className="text-sm text-ink-soft">No files attached yet. Open a record to add its first file.</p>
            );
          })()}
        </Card>
      ) : (
        <>
          {PAPERWORK_GROUPS.map((group) => {
            const groupRows = withState.filter(({ record }) => record.groupName === group);
            if (groupRows.length === 0) return null;
            return (
              <Card key={group} title={group}>
                <ul className="divide-y divide-line">{groupRows.map(recordRow)}</ul>
              </Card>
            );
          })}
          {records.length === 0 && (
            <p className="text-sm text-ink-soft">No records match that search.</p>
          )}
        </>
      )}

      {isOwner && all.length > 0 && (
        <>
          <form action={addStarterChecklistAction}>
            <Button type="submit" variant="secondary">Add any missing starter records</Button>
            <p className="mt-2 text-xs text-ink-soft">Brings in starter records you haven&apos;t got yet. Nothing you&apos;ve entered is changed, and adding them twice changes nothing.</p>
          </form>
          <Card
            title="Export a pack"
            description="A ZIP of the chosen records' files plus an index you can hand to your accountant or keep off-site."
          >
            <ExportPicker records={all.map((r) => ({ id: r.id, title: r.title }))} />
          </Card>
          <Card
            title="Who else can see records"
            description="Admins can open records of the kinds you tick, read-only — except any record holding a stored number, which is always owner-only. This is a starting value you can change any time; it hasn't been confirmed in Decisions & reviews yet."
          >
            <form action={updateAdminKindsAction} className="space-y-3">
              <div className="grid gap-1 sm:grid-cols-3">
                {RECORD_KINDS.map((kind) => (
                  <label key={kind} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="adminKind" value={kind} defaultChecked={adminKinds.includes(kind)} />
                    {RECORD_KIND_LABEL[kind]}
                    {recommended.includes(kind) ? <span className="text-xs text-ink-soft">(recommended)</span> : null}
                  </label>
                ))}
              </div>
              <Button type="submit" variant="secondary">Save who can see records</Button>
            </form>
          </Card>
        </>
      )}
    </div>
  );
}
