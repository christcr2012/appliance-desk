"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Field, Select, Textarea } from "@/components/ui";
import { REASON_REQUIRED, TEAM_STATE_WORDS, type FeedbackStateName } from "@/domains/feedback/rules";
import {
  addInternalNoteAction, markDuplicateAction, replyToReporterAction, setFeedbackStateAction,
  type FeedbackActionResult,
} from "./actions";

type Panel = "reply" | "note" | "status" | "duplicate" | null;

/** MCP-10a: the owner/admin actions on one report. Every change is checked again on the server. */
export function TriageActions({
  id, version, allowedStates, canMarkDuplicate, locked,
}: {
  id: string; version: number; allowedStates: FeedbackStateName[]; canMarkDuplicate: boolean; locked: boolean;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [nextState, setNextState] = useState("");
  const [toState, setToState] = useState(allowedStates[0] ?? "");
  const [reason, setReason] = useState("");
  const [number, setNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function open(next: Panel) {
    setPanel(next);
    setError(null);
    setNotice(null);
  }

  function finish(result: FeedbackActionResult, success: string) {
    if (result.status !== "success") {
      setError(result.message);
      return;
    }
    setText("");
    setReason("");
    setNumber("");
    setNextState("");
    setPanel(null);
    setNotice(success);
    router.refresh();
  }

  function run(work: () => Promise<FeedbackActionResult>, success: string) {
    setError(null);
    startTransition(async () => finish(await work(), success));
  }

  if (locked) return <p className="text-sm text-ink-soft">This report&apos;s content was removed at the person&apos;s request, so it can&apos;t be changed.</p>;
  const needsReason = REASON_REQUIRED.includes(toState as FeedbackStateName);
  return (
    <section aria-label="Actions" className="space-y-4 rounded-card border border-line bg-surface p-4 sm:p-6">
      <div className="flex flex-wrap gap-3">
        <Button variant={panel === "reply" ? "primary" : "secondary"} onClick={() => open("reply")}>Reply</Button>
        <Button variant={panel === "note" ? "primary" : "secondary"} onClick={() => open("note")}>Add a note</Button>
        {allowedStates.length > 0 && (
          <Button variant={panel === "status" ? "primary" : "secondary"} onClick={() => open("status")}>Change status…</Button>
        )}
        {canMarkDuplicate && (
          <Button variant={panel === "duplicate" ? "primary" : "secondary"} onClick={() => open("duplicate")}>Mark as already reported…</Button>
        )}
      </div>

      {panel === "reply" && (
        <div className="space-y-3">
          <Textarea label="Message to them" value={text} onChange={(event) => setText(event.target.value)} maxLength={4000} rows={4} help="They see this on their report." />
          {allowedStates.length > 0 && (
            <Select label="and mark as" value={nextState} onChange={(event) => setNextState(event.target.value)}>
              <option value="">Keep the status</option>
              {allowedStates.map((state) => <option key={state} value={state}>{TEAM_STATE_WORDS[state]}</option>)}
            </Select>
          )}
          <Button disabled={pending || !text.trim()} onClick={() => run(() => replyToReporterAction(id, version, text, nextState || null), "Reply sent.")}>Send reply</Button>
        </div>
      )}

      {panel === "note" && (
        <div className="space-y-3">
          <Textarea label="Note" value={text} onChange={(event) => setText(event.target.value)} maxLength={4000} rows={3} help="Only your team sees this." />
          <Button disabled={pending || !text.trim()} onClick={() => run(() => addInternalNoteAction(id, text), "Note added.")}>Add note</Button>
        </div>
      )}

      {panel === "status" && (
        <div className="space-y-3">
          <Select label="New status" value={toState} onChange={(event) => setToState(event.target.value as FeedbackStateName)}>
            {allowedStates.map((state) => <option key={state} value={state}>{TEAM_STATE_WORDS[state]}</option>)}
          </Select>
          <Textarea
            label={needsReason ? "Reason (required)" : "Reason (optional)"}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            rows={2}
            help="Kept on the report's history. The person does not see it."
          />
          <p className="text-sm text-ink">Change this report to “{TEAM_STATE_WORDS[toState as FeedbackStateName] ?? ""}”?</p>
          <div className="flex flex-wrap gap-3">
            <Button disabled={pending || (needsReason && reason.trim().length < 3)} onClick={() => run(() => setFeedbackStateAction(id, version, toState, reason), "Status changed.")}>
              Yes, change it
            </Button>
            <Button variant="quiet" onClick={() => open(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {panel === "duplicate" && (
        <div className="space-y-3">
          <Field label="The other report's number" inputMode="numeric" value={number} onChange={(event) => setNumber(event.target.value)} help="For example 12. They will see “Already reported”, never the other report." />
          <div className="flex flex-wrap gap-3">
            <Button disabled={pending || !number.trim()} onClick={() => run(() => markDuplicateAction(id, version, number), "Marked as already reported.")}>Mark as already reported</Button>
            <Button variant="quiet" onClick={() => open(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
      {notice && <p role="status" className="text-sm font-semibold text-ink">{notice}</p>}
    </section>
  );
}
