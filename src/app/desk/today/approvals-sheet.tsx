"use client";
// AR-2 slice 2: the "Waiting for your approval" Sheet on Today (OWNER only —
// the page only renders it for the owner, and decideApprovalAction refuses
// anyone else itself). Approving is a money action: always through the
// confirmation, never optimistic, never Undo (KIT 6.6). The card stays until
// the action answers; the outcome arrives as a toast with the shared
// OUTCOME_WORDS (src/domains/approvals/words.ts).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, Sheet, toast, type ConfirmSpec } from "@/components/kit";
import { OUTCOME_WORDS } from "@/domains/approvals/words";
import { formatShortDate } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";

export type ApprovalCardData = {
  id: string;
  summary: string;
  requestedBy: string;
  createdAt: string;
  expiresAt: string;
  amountCents: number;
  expired: boolean;
};

type DecideAction = (form: FormData) => Promise<unknown>;

const DANGER_OUTCOMES = new Set(["failed", "uncertain", "refused"]);

export function ApprovalsSheet({
  requests,
  decideAction,
  open,
  onOpenChange,
}: {
  requests: ApprovalCardData[];
  decideAction: DecideAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  // The cards are the latest server list minus the ones decided in this
  // session (PR #728 Codex P2): deriving them from the props means a
  // background refresh bringing a new request — or the next batch past the
  // 50-row page — shows up the next time the Sheet opens, while a card the
  // owner just decided never comes back from a stale render.
  const [decidedIds, setDecidedIds] = useState<ReadonlySet<string>>(new Set());
  const cards = requests.filter((r) => !decidedIds.has(r.id));
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{ card: ApprovalCardData; decision: "APPROVE" | "DECLINE" } | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  async function decide(card: ApprovalCardData, decision: "APPROVE" | "DECLINE") {
    setDecidingId(card.id);
    try {
      const form = new FormData();
      form.set("requestId", card.id);
      form.set("decision", decision);
      form.set("note", notes[card.id] ?? "");
      form.set("inline", "1");
      const result = (await decideAction(form)) as { outcome?: string } | undefined;
      const outcome = result?.outcome ?? "refused";
      toast({
        message: OUTCOME_WORDS[outcome] ?? outcome,
        tone: DANGER_OUTCOMES.has(outcome) ? "danger" : "good",
      });
      const next = new Set(decidedIds);
      next.add(card.id);
      setDecidedIds(next);
      if (requests.every((r) => next.has(r.id))) {
        onOpenChange(false);
        router.refresh();
      }
    } catch {
      // PR #728 Codex P2: a rejected call (network, unexpected server error)
      // must never fail silently on a money action — the outcome is unknown,
      // so say so and reconcile with the server before any retry.
      toast({
        message:
          "We could not confirm what happened, so nothing was assumed. Check the approvals page: the request may already be decided, so do not repeat it until you know.",
        tone: "danger",
      });
      router.refresh();
    } finally {
      setDecidingId(null);
    }
  }

  const spec: ConfirmSpec | null = confirm
    ? confirm.decision === "APPROVE"
      ? {
          title: `Approve ${formatMoney(confirm.card.amountCents)}?`,
          summary: `${confirm.card.summary}. It happens right away, as you. This can't be undone.`,
          confirmLabel: "Approve and do it now",
        }
      : {
          title: "Decline this request?",
          summary: "Nothing will change.",
          confirmLabel: "Decline",
        }
    : null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} title="Waiting for your approval">
        {cards.length === 0 ? (
          <p className="text-sm text-ink-soft">Nothing is waiting.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {cards.map((card) => (
              <li key={card.id} className="rounded-card border border-line bg-surface p-4">
                <p className="font-medium">{card.summary}</p>
                <p className="mt-1 text-xs text-ink-soft">
                  Asked by {card.requestedBy} · {formatShortDate(new Date(card.createdAt))} · {formatMoney(card.amountCents)}
                </p>
                <p className="text-xs text-ink-soft">
                  {card.expired
                    ? "Expired — can no longer be approved"
                    : `Expires ${formatShortDate(new Date(card.expiresAt))}`}
                </p>
                <label className="mt-3 block text-sm" htmlFor={`approval-note-${card.id}`}>
                  Note (optional)
                  <input
                    id={`approval-note-${card.id}`}
                    maxLength={300}
                    value={notes[card.id] ?? ""}
                    onChange={(event) => setNotes((current) => ({ ...current, [card.id]: event.target.value }))}
                    className="mt-1 min-h-11 w-full rounded-field border border-line-strong bg-surface px-3 text-[15px] font-normal text-ink"
                  />
                </label>
                <div className="mt-3 flex flex-wrap gap-3">
                  {!card.expired && (
                    <button
                      type="button"
                      disabled={decidingId !== null}
                      onClick={() => setConfirm({ card, decision: "APPROVE" })}
                      className="min-h-11 rounded-field border border-line-strong px-4 text-[15px] font-bold text-ink disabled:opacity-50"
                    >
                      Approve…
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={decidingId !== null}
                    onClick={() => setConfirm({ card, decision: "DECLINE" })}
                    className="min-h-11 rounded-field border border-line-strong px-4 text-[15px] text-ink disabled:opacity-50"
                  >
                    Decline…
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
      {spec && confirm ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setConfirm(null);
          }}
          spec={spec}
          onConfirm={() => {
            const target = confirm;
            setConfirm(null);
            void decide(target.card, target.decision);
          }}
        />
      ) : null}
    </>
  );
}
