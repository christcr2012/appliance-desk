import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { getRecord, listRecordHistory } from "@/domains/paperwork/records";
import { getCredentialForRecord } from "@/domains/vault";
import { OBLIGATIONS } from "@/domains/compliance/registry";
import { PAPERWORK_STATUS_LABEL, type PaperworkStatusValue } from "@/domains/paperwork/rules";
import { businessDateKey } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { Button, Card, PageHeader, StatusPill } from "@/components/ui";
import { deletePaperworkAction, markPaperworkDoneAction, updatePaperworkAction } from "../actions";
import {
  archiveRecordAction,
  clearRecordNumberAction,
  removeRecordFileAction,
} from "../record-actions";
import { PaperworkForm } from "../paperwork-form";
import { RecordFileUpload } from "../record-file-upload";
import { RenewRecordForm } from "../renew-record-form";

export const metadata = { title: "Business record" };
export const dynamic = "force-dynamic";

const HISTORY_LABEL: Record<string, string> = {
  "paperwork.created": "Record created",
  "paperwork.updated": "Details updated",
  "paperwork.marked_done": "Marked done",
  "paperwork.deleted": "Record deleted",
  "paperwork.starter_added": "Added from the starter list",
  "records.number_cleared": "Stored number removed",
  "records.renewed": "Renewed",
  "records.archived": "Archived",
  "records.file_added": "File added",
  "records.file_removed": "File removed",
  "records.file_downloaded": "File opened or downloaded",
  "records.exported": "Included in an export pack",
};


export default async function PaperworkItemPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole("OWNER", "ADMIN");
  const isOwner = session.user.role === "OWNER";
  const { id } = await params;
  const record = await getRecord(session.user.role, id);
  if (!record) notFound();

  const repeats = record.repeatEveryMonths !== null;
  const obligationTitle = new Map(OBLIGATIONS.map((o) => [o.key, o.title]));
  const history = isOwner ? await listRecordHistory(id) : [];
  // VAULT-2: the linked login (owner only — the vault is never visible to anyone else).
  const linkedLogin = isOwner ? await getCredentialForRecord(session.user.id, id).catch(() => null) : null;
  const factRows: [string, string][] = [
    ["Kind", record.kindLabel],
    ...(record.agency ? [["Handled by", record.agency] as [string, string]] : []),
    ...(record.issuedOn ? [["Issued", businessDateKey(record.issuedOn)] as [string, string]] : []),
    ...(record.expiresOn ? [["Expires", businessDateKey(record.expiresOn)] as [string, string]] : []),
    ...(record.dueOn ? [["Next action", businessDateKey(record.dueOn)] as [string, string]] : []),
    ...(record.costCents != null ? [["Cost", formatMoney(record.costCents)] as [string, string]] : []),
    ...(record.lastDoneOn ? [["Last done / renewed", businessDateKey(record.lastDoneOn)] as [string, string]] : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={record.title}
        description={record.whatItIs ?? undefined}
        secondaryActions={<Link href="/desk/paperwork" className="text-sm font-semibold text-action underline">Back to all records</Link>}
      />
      <p>
        <StatusPill
          tone={record.status === "DONE" ? "success" : record.status === "IN_PROGRESS" ? "progress" : record.status === "NOT_NEEDED" ? "stopped" : "pending"}
          label={PAPERWORK_STATUS_LABEL[record.status as PaperworkStatusValue]}
        />{" "}
        <span className="ml-2 inline-block rounded bg-accent px-1.5 py-0.5 text-xs font-semibold">{record.kindLabel}</span>
      </p>
      <div className="flex flex-wrap gap-4 text-sm">
        {record.officialUrl && (
          <a href={record.officialUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-action underline">
            Open the official website{record.agency ? ` (${record.agency})` : ""}
          </a>
        )}
        {record.portalUrl && (
          <a href={record.portalUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-action underline">
            Open the portal / sign-in page
          </a>
        )}
      </div>

      <Card title="The record">
        <dl className="grid gap-3 sm:grid-cols-2">
          {factRows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</dt>
              <dd className="text-sm">{value}</dd>
            </div>
          ))}
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
              {record.numberLabel ?? "Number"}
            </dt>
            <dd className="text-sm">
              {record.hasNumber ? (
                <>
                  ••••{record.numberLast4 ?? ""}{" "}
                  <span className="text-ink-soft">(stored encrypted; the full number is never shown here)</span>
                </>
              ) : (
                "Not on file"
              )}
            </dd>
            {isOwner && record.hasNumber && (
              <form action={clearRecordNumberAction.bind(null, record.id)} className="mt-1">
                <Button type="submit" variant="secondary">Remove the stored number</Button>
              </form>
            )}
          </div>
          {record.linkedObligationKeys.length > 0 && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Used for</dt>
              <dd className="text-sm">{record.linkedObligationKeys.map((k) => obligationTitle.get(k) ?? k).join(", ")}</dd>
            </div>
          )}
          {!isOwner && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Access</dt>
              <dd className="text-sm">You&apos;re seeing this record because the owner shares its kind with admins. It&apos;s read-only.</dd>
            </div>
          )}
        </dl>
        {isOwner && record.notes && <p className="mt-4 whitespace-pre-wrap text-sm text-ink-soft">{record.notes}</p>}
      </Card>

      {isOwner && (
        <Card title="Login" description="The vault login for this account, if you've saved one. The password itself lives in the vault — it's shown only there, after a fresh sign-in code.">
          {linkedLogin ? (
            <p className="text-sm">
              Login:{" "}
              <Link href={`/desk/vault/${linkedLogin.id}`} className="font-semibold text-action underline">
                {linkedLogin.title}
              </Link>
            </p>
          ) : (
            <p className="text-sm text-ink-soft">
              No login linked yet. Save it in the{" "}
              <Link href="/desk/vault" className="font-semibold text-action underline">
                Logins vault
              </Link>{" "}
              and link it to this record there.
            </p>
          )}
        </Card>
      )}

      <Card title="Files" description="Stored privately. Photos and documents on this record, newest kept as history when replaced.">
        {record.files.length === 0 ? (
          <p className="text-sm text-ink-soft">No files yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {record.files.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <a href={`/api/records/files/${file.id}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-action underline">
                    {file.label || file.fileName}
                  </a>
                  <p className="text-sm text-ink-soft">
                    {file.fileName} · {(file.sizeBytes / 1024).toFixed(0)} KB · added {businessDateKey(file.uploadedAt)}
                  </p>
                  {file.contentType.startsWith("image/") && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/records/files/${file.id}`} alt={file.label || file.fileName} className="mt-2 max-h-40 rounded border border-line" />
                  )}
                </div>
                {isOwner && (
                  <form action={removeRecordFileAction.bind(null, record.id, file.id)}>
                    <Button type="submit" variant="secondary">Remove</Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {isOwner && (
          <div className="mt-4 border-t border-line pt-4">
            <RecordFileUpload recordId={record.id} />
          </div>
        )}
      </Card>

      {isOwner && (
        <>
          <Card
            title="Renewed it?"
            description={
              repeats
                ? "When you've renewed or filed it, put the new expiry date here (or leave the dates blank to advance by the repeat length). The old files stay on the record as history."
                : "When you've renewed it, put the new expiry date here. The old files stay on the record as history."
            }
          >
            <RenewRecordForm
              recordId={record.id}
              expectedVersion={record.version}
              currentExpiresOn={record.expiresOn ? businessDateKey(record.expiresOn) : ""}
              currentDueOn={record.dueOn ? businessDateKey(record.dueOn) : ""}
            />
          </Card>
          <Card
            title="Done with it for now?"
            description="Marking done moves a repeating record to its next date and stops the reminder until then."
          >
            <form action={markPaperworkDoneAction.bind(null, record.id, record.version)}>
              <Button type="submit" variant="secondary">
                {repeats ? "Mark done and schedule the next one" : "Mark done"}
              </Button>
            </form>
          </Card>
          <Card title="Details">
            <PaperworkForm
              action={updatePaperworkAction.bind(null, record.id, record.version)}
              submitLabel="Save changes"
              obligationOptions={OBLIGATIONS.map((o) => ({ key: o.key, title: o.title }))}
              initial={{
                title: record.title,
                groupName: record.groupName,
                status: record.status,
                whatItIs: record.whatItIs ?? "",
                agency: record.agency ?? "",
                officialUrl: record.officialUrl ?? "",
                referenceNumber: record.referenceNumber ?? "",
                startedOn: record.startedOn ? businessDateKey(record.startedOn) : "",
                dueOn: record.dueOn ? businessDateKey(record.dueOn) : "",
                remindDaysBefore: record.remindDaysBefore,
                repeatEveryMonths: record.repeatEveryMonths ? String(record.repeatEveryMonths) : "",
                notes: record.notes ?? "",
                kind: record.kind,
                issuedOn: record.issuedOn ? businessDateKey(record.issuedOn) : "",
                expiresOn: record.expiresOn ? businessDateKey(record.expiresOn) : "",
                numberLabel: record.numberLabel ?? "",
                hasNumber: record.hasNumber,
                numberLast4: record.numberLast4 ?? "",
                portalUrl: record.portalUrl ?? "",
                costDollars: record.costDollars ?? "",
                linkedObligationKeys: record.linkedObligationKeys,
              }}
            />
          </Card>
          <Card title="History">
            {history.length === 0 ? (
              <p className="text-sm text-ink-soft">Nothing recorded yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {history.map((row) => (
                  <li key={row.id}>
                    {businessDateKey(row.createdAt)} — {HISTORY_LABEL[row.action] ?? row.action}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Archive or remove">
            <p className="mb-3 text-sm text-ink-soft">
              Archiving keeps the record and its files but takes it off your lists and reminders. Deleting is permanent and only for records you added yourself.
            </p>
            <div className="flex flex-wrap gap-3">
              <form action={archiveRecordAction.bind(null, record.id, record.version)}>
                <Button type="submit" variant="secondary">Archive this record</Button>
              </form>
              {!record.templateKey && (
                <form action={deletePaperworkAction.bind(null, record.id)}>
                  <Button type="submit" variant="danger">Delete this record</Button>
                </form>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
