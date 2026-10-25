// AR-0 kit 4.22 (DEC-1b): one question in Settings › Decisions & reviews — title, question, "Doing now:" with its
// state pill, "Why this starting value" (folded, with its sources), "Affects:" links, an optional note and the
// actions the caller allows (none for read-only viewers).
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./icons";
import { StatusPill } from "./status-pill";
import type { Tone } from "./types";

export type DecisionCardProps = {
  title: string;
  question: string;
  doingNow: string;
  pills: { label: string; tone: Tone }[];
  why?: { text: string; sources: { title: string; url: string; checkedOn: string }[] } | null;
  affects: { label: string; href: string }[];
  notes?: string[];
  actions?: ReactNode;
};

export function DecisionCard({ title, question, doingNow, pills, why, affects, notes = [], actions }: DecisionCardProps) {
  return (
    <article className="rounded-card border border-line bg-surface px-4 py-3.5" aria-label={title}>
      <h2 className="text-base font-bold text-ink">{title}</h2>
      <p className="mt-1 text-[15px] text-ink">{question}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-sm text-ink">
          <span className="font-bold">Doing now:</span> {doingNow}
        </p>
        {pills.map((pill) => <StatusPill key={pill.label} label={pill.label} tone={pill.tone} />)}
      </div>
      {why ? (
        <details className="group mt-2 text-sm">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 font-semibold text-link lg:min-h-9 [&::-webkit-details-marker]:hidden">
            <Icon name="info" size={20} />
            Why this starting value
          </summary>
          <div className="mt-1 space-y-2 rounded-field bg-tint p-3 text-ink">
            <p>{why.text}</p>
            {why.sources.length > 0 ? (
              <ul className="space-y-1">
                {why.sources.map((source) => (
                  <li key={source.url}>
                    <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline">{source.title}</a>
                    <span className="text-ink-soft">, checked {source.checkedOn}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </details>
      ) : null}
      {affects.length > 0 ? (
        <p className="mt-2 text-sm text-ink-soft">
          Affects:{" "}
          {affects.map((item, index) => (
            <span key={item.href + item.label}>
              {index > 0 ? ", " : null}
              <Link href={item.href} className="underline">{item.label}</Link>
            </span>
          ))}
        </p>
      ) : null}
      {notes.map((note) => <p key={note} className="mt-1 text-sm text-ink-soft">{note}</p>)}
      {actions ? <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div> : null}
    </article>
  );
}
