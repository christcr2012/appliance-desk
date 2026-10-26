"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, StatusPill } from "@/components/ui";
import { confirmRecallAction, notOursRecallAction, remediedRecallAction } from "../actions";

type State = "POSSIBLE" | "CONFIRMED" | "NOT_OURS" | "REMEDIED";
const LABEL: Record<State, { text: string; tone: "attention" | "stopped" | "success" | "pending" }> = {
  POSSIBLE: { text: "To check", tone: "attention" },
  CONFIRMED: { text: "On hold", tone: "stopped" },
  NOT_OURS: { text: "Not ours", tone: "pending" },
  REMEDIED: { text: "Fixed", tone: "success" },
};

export function MatchRow(props: {
  matchId: string; state: State; title: string; detail: string; serial: string | null; reason: string; decisionNote: string | null;
  renters: string[]; applianceHref: string; drafts: { name: string; text: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"none" | "not-ours" | "fixed">("none");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function run(action: () => ReturnType<typeof confirmRecallAction>) {
    setMessage(null);
    start(async () => {
      const result = await action();
      if (result.status === "error") return setMessage({ ok: false, text: result.message });
      setMessage({ ok: true, text: result.status === "success" ? result.message ?? "Saved." : "Saved." });
      setMode("none");
      setNote("");
      router.refresh();
    });
  }

  const label = LABEL[props.state];
  return (
    <li className="rounded-card border border-line bg-surface p-4" data-testid="recall-match">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={props.applianceHref} className="font-semibold text-ink underline">{props.title}</Link>
        <StatusPill tone={label.tone} label={label.text} />
      </div>
      <p className="mt-1 text-sm text-ink-soft">{props.detail}{props.serial ? ` · serial ${props.serial}` : ""}</p>
      <p className="mt-1 text-sm text-ink-soft">{props.reason}</p>
      {props.decisionNote && <p className="mt-1 text-sm text-ink-soft">Your note: {props.decisionNote}</p>}
      {props.renters.length > 0 && <p className="mt-1 text-sm">Being rented by: {props.renters.join(", ")}</p>}

      {props.state === "POSSIBLE" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" disabled={pending} onClick={() => run(() => confirmRecallAction(props.matchId))}>It&apos;s ours</Button>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => setMode(mode === "not-ours" ? "none" : "not-ours")}>Not ours</Button>
        </div>
      )}
      {props.state === "CONFIRMED" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={pending} onClick={() => setMode(mode === "fixed" ? "none" : "fixed")}>The fix is done</Button>
          <Button type="button" variant="quiet" disabled={pending} onClick={() => setMode(mode === "not-ours" ? "none" : "not-ours")}>I was wrong: not ours</Button>
        </div>
      )}
      {props.state === "NOT_OURS" && (
        <div className="mt-3">
          <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => confirmRecallAction(props.matchId))}>Actually, it is ours</Button>
        </div>
      )}

      {mode !== "none" && (
        <form
          className="mt-3 grid gap-2 sm:max-w-md"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => (mode === "fixed" ? remediedRecallAction(props.matchId, note) : notOursRecallAction(props.matchId, note)));
          }}
        >
          <Field
            id={`note-${props.matchId}`}
            label={mode === "fixed" ? "What was done?" : "Why doesn't it apply?"}
            value={note} onChange={(e) => setNote(e.target.value)}
            help={mode === "fixed" ? "For example: repair kit installed on the date of the fix." : "For example: the model number isn't on the recall list."}
            required
          />
          <div><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button></div>
        </form>
      )}

      {props.state === "CONFIRMED" && props.drafts.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold">Message to send to the people renting it</summary>
          <p className="mt-2 text-sm text-ink-soft">The app doesn&apos;t send this. Read it, change it if you like, and send it yourself.</p>
          {props.drafts.map((draft) => (
            <pre key={draft.name} className="mt-2 whitespace-pre-wrap rounded-control border border-line bg-subtle p-3 text-sm">{draft.text}</pre>
          ))}
        </details>
      )}
      {message && <p role={message.ok ? "status" : "alert"} className={`mt-2 text-sm font-semibold ${message.ok ? "text-ink" : "text-danger"}`}>{message.text}</p>}
    </li>
  );
}
