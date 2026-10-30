import Link from "next/link";
import { redirect } from "next/navigation";
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
import { Button, Card, EmptyState, StatusPill } from "@/components/ui";
import { addStarterChecklistAction } from "./actions";
import { updateAdminKindsAction } from "./record-actions";
import { ExportPicker } from "./export-picker";

import { DataTable, ScreenHeader, StatusTabs, Toolbar, type Column } from "@/components/kit";

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

type RecordRow = {
  record: Awaited<ReturnType<typeof listRecords>>[number];
  state: ReturnType<typeof reminderState>;
  isExpiry: boolean;
};

function recordMain({ record, state, isExpiry }: RecordRow) {
  return (
    <div className="min-w-0">
      <span className="font-semibold text-ink">{record.title}</span>
      <p className="text-sm text-ink-soft">
        <span className="mr-2 inline-block rounded bg-accent px-1.5 py-0.5 text-xs font-semibold">{record.kindLabel}</span>
        {record.status === "NOT_NEEDED" ? "Not needed / archived" : dueText(state, record.effectiveDate, isExpiry)}
        {record.hasNumber ? ` · ${record.numberLabel ?? "Number"} ••••${record.numberLast4 ?? ""}` : ""}
        {!record.hasNumber && record.referenceNumber ? ` · Number ${maskReference(record.referenceNumber)}` : ""}
        {record.files.length > 0 ? ` · ${record.files.length} file${record.files.length === 1 ? "" : "s"}` : ""}
      </p>
    </div>
  );
}

function recordPill({ record }: RecordRow) {
  return (
    <StatusPill
      tone={record.status === "DONE" ? "success" : record.status === "IN_PROGRESS" ? "progress" : record.status === "NOT_NEEDED" ? "stopped" : "pending"}
      label={PAPERWORK_STATUS_LABEL[record.status as PaperworkStatusValue]}
    />
  );
}

const recordColumns: Column<RecordRow>[] = [
  { key: "record", header: "Record", cell: recordMain },
  { key: "status", header: "Status", cell: recordPill },
];

function RecordsTable({ rows, caption }: { rows: RecordRow[]; caption: string }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.record.id}
      columns={recordColumns}
      caption={caption}
      rowHref={(row) => `/desk/paperwork/${row.record.id}`}
      mobileCard={(row) => (
        <div className="space-y-1">
          {recordMain(row)}
          {recordPill(row)}
        </div>
      )}
      empty={null}
    />
  );
}

export default async function PaperworkPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; open?: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "ACCOUNTANT");
  const isOwner = session.user.role === "OWNER";
  const isAccountant = session.user.role === "ACCOUNTANT";
  const { tab: tabParam, q, open } = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "needs-you";
  const query = (q ?? "").trim();
  const all = await listRecords(session.user.role);
  // The kit table's row click sets ?open=<id> (its side-panel convention).
  // Records have no side panel — the record page IS the destination, as it
  // was before the redesign — so an ?open= link goes straight there. The
  // Files tab's rows carry file ids, not record ids, so only an id that
  // names a real record redirects.
  if (open && all.some((r) => r.id === open)) redirect(`/desk/paperwork/${encodeURIComponent(open)}`);
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

  return (
    <div className="space-y-6">
      <ScreenHeader
        title="Business records"
        list
        primary={isOwner ? { kind: "link", label: "Add a record", href: "/desk/paperwork/new" } : undefined}
      />
      <p className="-mt-2 pb-2 text-sm text-ink-soft">
        {isOwner
          ? "LLC papers, licenses, tax accounts, insurance, contracts and their files. Stored numbers stay encrypted, shown only to you, masked."
          : isAccountant
            ? "Records the owner shared with you. Stored numbers are never shown — only that one is on file. You can add files to a shared record."
            : "The business records the owner shares with admins. Records holding a stored number, and the numbers themselves, are owner-only."}
      </p>

      <StatusTabs
        label="Record views"
        param="tab"
        current={tab}
        items={TABS.map((t) => ({ value: t.key, label: t.label }))}
      />

      <Toolbar search={{ label: "Search records", placeholder: "Search titles, agencies, file names…" }} />

      {all.length === 0 && !query ? (
        <>
          <EmptyState
            title="Nothing here yet"
            description="Starter records for a new Colorado rental business: LLC papers, EIN letter, licenses, tax accounts, insurance and contracts."
            action={
              isOwner ? (
                <form action={addStarterChecklistAction}>
                  <Button type="submit">Set up my starter records</Button>
                </form>
              ) : undefined
            }
          />
          <p className="mt-3 text-sm text-ink-soft">
            You can change, skip or add to any of it. The list states no fees or deadlines; you enter the dates from your own papers.
          </p>
        </>
      ) : tab === "needs-you" ? (
        <>
          {needsAttention.length > 0 ? (
            <Card title="Needs your attention" description="Due soon or already past due.">
              <RecordsTable rows={needsAttention} caption="Records that need you" />
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
              <RecordsTable rows={upcoming} caption="Coming up" />
            ) : (
              <p className="text-sm text-ink-soft">Nothing with a date in the next 12 months.</p>
            );
          })()}
        </Card>
      ) : tab === "files" ? (
        <Card title="All files">
          {(() => {
            const withFiles = records.filter((r) => r.files.length > 0);
            const fileRows = withFiles.flatMap((record) => record.files.map((file) => ({ file, record })));
            const fileCell = ({ file, record }: (typeof fileRows)[number]) => (
              <div className="min-w-0">
                <a href={`/api/records/files/${file.id}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-action underline">
                  {file.label || file.fileName}
                </a>
                <p className="text-sm text-ink-soft">
                  On <Link href={`/desk/paperwork/${record.id}`} className="underline">{record.title}</Link> · {(file.sizeBytes / 1024).toFixed(0)} KB · added {businessDateKey(file.uploadedAt)}
                </p>
              </div>
            );
            // The desktop table's first cell sits inside the kit's row link,
            // so it renders the same words without any link of its own; the
            // download lives in its own column there. Phone cards keep the
            // linked layout (no row link wraps them on this table).
            const fileMain = ({ file, record }: (typeof fileRows)[number]) => (
              <div className="min-w-0">
                <span className="font-semibold text-ink">{file.label || file.fileName}</span>
                <p className="text-sm text-ink-soft">
                  On {record.title} · {(file.sizeBytes / 1024).toFixed(0)} KB · added {businessDateKey(file.uploadedAt)}
                </p>
              </div>
            );
            const fileDownload = ({ file }: (typeof fileRows)[number]) => (
              <a href={`/api/records/files/${file.id}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-action underline">
                Open file
              </a>
            );
            return withFiles.length > 0 ? (
              <DataTable
                rows={fileRows}
                rowKey={(row) => row.file.id}
                columns={[
                  { key: "file", header: "File", cell: fileMain },
                  { key: "download", header: "Download", cell: fileDownload },
                ]}
                caption="All files"
                mobileCard={fileCell}
                empty={null}
              />
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
                <RecordsTable rows={groupRows} caption={group} />
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
            description="Admins can open records of the kinds you tick, read-only — except any record holding a stored number, which is always owner-only."
          >
            <p className="mb-3 text-sm text-ink-soft">
              This is a starting value you can change any time; it hasn&apos;t been confirmed in Decisions &amp; reviews yet.
            </p>
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
