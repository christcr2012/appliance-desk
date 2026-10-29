"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, Sheet, toast } from "@/components/kit";
import { LEAD_LOST_REASONS } from "@/domains/leads/lost-reasons";
import {
  bulkLeadAction,
  convertLeadAction,
  logLeadContactAction,
  reassignLeadAction,
  setLeadFollowUpAction,
  updateLeadStatusAction,
} from "./actions";

export type SheetKind = "followup" | "assign" | "log" | "lost" | "convert";

export type SheetLead = {
  id: string;
  contactName: string;
  stage: string;
  version: number;
  nextFollowUpKey: string | null;
};

const inputClass =
  "min-h-11 w-full rounded-field border border-line bg-surface px-3 text-[15px] text-ink lg:min-h-10";
const labelClass = "text-sm font-semibold text-ink";
const saveClass =
  "inline-flex min-h-11 items-center rounded-field bg-primary px-4 text-[15px] font-bold text-on-primary disabled:opacity-60 lg:min-h-10";

/**
 * AR-4b: the queue/record row-action sheets, opened by URL (?sheet=…&lead=…)
 * so the server-rendered list stays the source of truth. Each submit calls
 * the thin S3 action, toasts the result, and returns to the plain list URL.
 */
export function LeadRowSheets({
  lead,
  sheet,
  owners,
  defaultFollowUpKey,
  closeHref,
}: {
  lead: SheetLead;
  sheet: SheetKind;
  owners: { id: string; name: string }[];
  defaultFollowUpKey: string;
  closeHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const close = () => router.push(closeHref, { scroll: false });

  const [dateKey, setDateKey] = useState(lead.nextFollowUpKey ?? defaultFollowUpKey);
  const [ownerId, setOwnerId] = useState("");
  const [kind, setKind] = useState<"CONTACTED" | "ATTEMPT">("CONTACTED");
  const [body, setBody] = useState("");
  const [planKey, setPlanKey] = useState(defaultFollowUpKey);
  const [planOn, setPlanOn] = useState(false);
  const [reason, setReason] = useState<string>(LEAD_LOST_REASONS[0]);
  const [otherReason, setOtherReason] = useState("");

  function run(ok: boolean, message: string, undo?: () => Promise<void>) {
    if (ok) {
      toast({ message, ...(undo ? { undo } : {}) });
      close();
      router.refresh();
    } else {
      toast({ message, tone: "danger" });
    }
  }

  const submitFollowUp = () =>
    startTransition(async () => {
      const oldKey = lead.nextFollowUpKey;
      const oldVersion = lead.version;
      const r = await setLeadFollowUpAction(lead.id, oldVersion, dateKey || null);
      run(r.status === "success", r.status === "success" ? "Follow-up set" : r.message, async () => {
        await setLeadFollowUpAction(lead.id, oldVersion + 1, oldKey);
        router.refresh();
      });
    });

  const submitAssign = () =>
    startTransition(async () => {
      const r = await reassignLeadAction(lead.id, ownerId || null);
      run(r.status === "success", r.status === "success" ? "Owner changed" : r.message);
    });

  const submitLog = () =>
    startTransition(async () => {
      const r = await logLeadContactAction(
        lead.id,
        kind,
        body,
        lead.stage === "new" && planOn ? planKey : undefined,
      );
      run(r.status === "success", r.status === "success" ? "Contact logged" : r.message);
    });

  const submitLost = () =>
    startTransition(async () => {
      const finalReason = reason === "Other" ? otherReason.trim() : reason;
      const r = await updateLeadStatusAction(lead.id, "LOST", finalReason);
      run(r.status === "success", r.status === "success" ? "Lead marked lost" : r.status === "error" ? r.message : "Done");
    });

  if (sheet === "convert") {
    return (
      <ConfirmDialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
        spec={{
          title: `Make ${lead.contactName} a customer?`,
          summary:
            "This creates their customer record and account. Their notes and quotes stay linked.",
          confirmLabel: "Convert to customer",
        }}
        onConfirm={() =>
          startTransition(async () => {
            const r = await convertLeadAction(lead.id);
            if (r.status === "converted") {
              toast({ message: "Became a customer" });
              router.push(`/desk/customers/${r.customerId}`);
            } else {
              toast({
                message: r.status === "error" ? r.message : "Couldn't convert that lead.",
                tone: "danger",
              });
              close();
            }
          })
        }
      />
    );
  }

  if (sheet === "followup") {
    return (
      <Sheet open onOpenChange={(o) => !o && close()} title="Set follow-up…" footer={
        <button type="button" className={saveClass} disabled={pending} onClick={submitFollowUp}>
          {pending ? "Saving…" : "Save"}
        </button>
      }>
        <label className={labelClass} htmlFor="lead-followup-date">Follow up on</label>
        <input
          id="lead-followup-date"
          type="date"
          className={inputClass}
          value={dateKey}
          onChange={(e) => setDateKey(e.target.value)}
        />
        {lead.nextFollowUpKey ? (
          <button
            type="button"
            className="mt-3 text-[15px] font-semibold text-primary"
            onClick={() =>
              startTransition(async () => {
                const r = await setLeadFollowUpAction(lead.id, lead.version, null);
                run(r.status === "success", r.status === "success" ? "Follow-up cleared" : r.message);
              })
            }
          >
            Clear the follow-up date
          </button>
        ) : null}
      </Sheet>
    );
  }

  if (sheet === "assign") {
    return (
      <Sheet open onOpenChange={(o) => !o && close()} title="Assign to…" footer={
        <button type="button" className={saveClass} disabled={pending} onClick={submitAssign}>
          {pending ? "Saving…" : "Save"}
        </button>
      }>
        <label className={labelClass} htmlFor="lead-assign-owner">Owner</label>
        <select id="lead-assign-owner" className={inputClass} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          <option value="">Unassigned</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </Sheet>
    );
  }

  if (sheet === "log") {
    return (
      <Sheet open onOpenChange={(o) => !o && close()} title="Log a contact…" footer={
        <button type="button" className={saveClass} disabled={pending || !body.trim()} onClick={submitLog}>
          {pending ? "Saving…" : "Save"}
        </button>
      }>
        <div className="flex gap-2" role="group" aria-label="How did it go">
          {(
            [
              ["CONTACTED", "I reached them"],
              ["ATTEMPT", "Tried, no answer"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              className={`min-h-11 flex-1 rounded-field border px-3 text-[15px] font-semibold lg:min-h-10 ${
                kind === value ? "border-primary bg-primary text-on-primary" : "border-line text-ink"
              }`}
              onClick={() => setKind(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className={`${labelClass} mt-4 block`} htmlFor="lead-log-body">What happened</label>
        <textarea
          id="lead-log-body"
          className={`${inputClass} min-h-24 py-2`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        {lead.stage === "new" ? (
          <div className="mt-4">
            <label className="flex items-center gap-2 text-[15px] text-ink">
              <input type="checkbox" className="h-5 w-5 accent-primary" checked={planOn} onChange={(e) => setPlanOn(e.target.checked)} />
              Follow up on
            </label>
            {planOn ? (
              <input
                type="date"
                aria-label="Follow up on"
                className={`${inputClass} mt-2`}
                value={planKey}
                onChange={(e) => setPlanKey(e.target.value)}
              />
            ) : null}
          </div>
        ) : null}
      </Sheet>
    );
  }

  return (
    <Sheet open onOpenChange={(o) => !o && close()} title="Mark lost…" footer={
      <button
        type="button"
        className={saveClass}
        disabled={pending || (reason === "Other" && !otherReason.trim())}
        onClick={submitLost}
      >
        {pending ? "Saving…" : "Mark lost"}
      </button>
    }>
      <label className={labelClass} htmlFor="lead-lost-reason">Reason</label>
      <select id="lead-lost-reason" className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)}>
        {LEAD_LOST_REASONS.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
        <option value="Other">Other</option>
      </select>
      {reason === "Other" ? (
        <input
          aria-label="Other reason"
          className={`${inputClass} mt-3`}
          value={otherReason}
          onChange={(e) => setOtherReason(e.target.value)}
          placeholder="Say why"
        />
      ) : null}
    </Sheet>
  );
}

export type BulkKind = "assign" | "follow-up" | "lost";

/**
 * AR-4b: the bulk bar's sheets. The kit bulk bar posts the checked ids to a
 * staging action that lands here (?bulk=…&ids=…); the submit runs
 * bulkLeadAction and reports "Updated {done} leads" — with the failures
 * listed in place when some leads couldn't be changed.
 */
export function BulkLeadSheets({
  kind,
  ids,
  owners,
  defaultFollowUpKey,
  closeHref,
}: {
  kind: BulkKind;
  ids: string[];
  owners: { id: string; name: string }[];
  defaultFollowUpKey: string;
  closeHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const close = () => router.push(closeHref, { scroll: false });
  const [ownerId, setOwnerId] = useState("");
  const [dateKey, setDateKey] = useState(defaultFollowUpKey);
  const [reason, setReason] = useState<string>(LEAD_LOST_REASONS[0]);
  const [otherReason, setOtherReason] = useState("");
  const [failures, setFailures] = useState<{ id: string; message: string }[] | null>(null);
  const [doneCount, setDoneCount] = useState(0);

  const titles: Record<BulkKind, string> = {
    assign: "Assign to…",
    "follow-up": "Set follow-up…",
    lost: "Mark lost…",
  };

  const submit = () =>
    startTransition(async () => {
      const payload =
        kind === "assign"
          ? { toUserId: ownerId || null }
          : kind === "follow-up"
            ? { dateKey }
            : { reason: reason === "Other" ? otherReason.trim() : reason };
      const r = await bulkLeadAction(kind, ids, payload);
      if (r.status === "error") {
        toast({ message: r.message, tone: "danger" });
        return;
      }
      if (r.result.failed.length === 0) {
        toast({ message: `Updated ${r.result.done} leads` });
        close();
        router.refresh();
      } else {
        setDoneCount(r.result.done);
        setFailures(r.result.failed);
        router.refresh();
      }
    });

  return (
    <Sheet open onOpenChange={(o) => !o && close()} title={titles[kind]} footer={
      failures ? (
        <button type="button" className={saveClass} onClick={close}>Done</button>
      ) : (
        <button
          type="button"
          className={saveClass}
          disabled={pending || (kind === "lost" && reason === "Other" && !otherReason.trim())}
          onClick={submit}
        >
          {pending ? "Saving…" : `Update ${ids.length} leads`}
        </button>
      )
    }>
      {failures ? (
        <div>
          <p className="text-[15px] text-ink">
            Updated {doneCount} leads · {failures.length} couldn&apos;t be changed
          </p>
          <ul className="mt-2 space-y-1 text-sm text-ink-soft">
            {failures.map((f) => (
              <li key={f.id}>{f.message}</li>
            ))}
          </ul>
        </div>
      ) : kind === "assign" ? (
        <>
          <label className={labelClass} htmlFor="bulk-assign-owner">Owner</label>
          <select id="bulk-assign-owner" className={inputClass} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">Unassigned</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </>
      ) : kind === "follow-up" ? (
        <>
          <label className={labelClass} htmlFor="bulk-followup-date">Follow up on</label>
          <input id="bulk-followup-date" type="date" className={inputClass} value={dateKey} onChange={(e) => setDateKey(e.target.value)} />
        </>
      ) : (
        <>
          <label className={labelClass} htmlFor="bulk-lost-reason">Reason</label>
          <select id="bulk-lost-reason" className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)}>
            {LEAD_LOST_REASONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
            <option value="Other">Other</option>
          </select>
          {reason === "Other" ? (
            <input aria-label="Other reason" className={`${inputClass} mt-3`} value={otherReason} onChange={(e) => setOtherReason(e.target.value)} placeholder="Say why" />
          ) : null}
        </>
      )}
    </Sheet>
  );
}
