"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { OverflowMenu, StatusPill, toast } from "@/components/kit";
import type { MenuItem } from "@/components/kit";
import { updateLeadStatusAction } from "./actions";

export type BoardCard = {
  id: string;
  contactName: string;
  line: string;
  nextStep: string;
  score: number;
};

export type BoardColumn = {
  stage: "new" | "contacted" | "quoted";
  label: string;
  cards: BoardCard[];
};

/**
 * AR-4b (LEADS.md section 2): the board view — New / Contacted / Quote sent
 * columns, desktop only. Dragging New → Contacted logs the CONTACTED status
 * change; any column → Lost opens the Mark lost sheet (a link, rendered by
 * the page); Quote sent accepts no drops — it shows "Send a quote to move
 * here" while dragging. Every move also exists in the card's ⋯ menu, so
 * drag is never the only way.
 */
export function LeadsBoard({
  columns,
  lostHrefBase,
}: {
  columns: BoardColumn[];
  /** Serializable base href for the Mark-lost sheet; the card id is appended as &lead= (a function prop cannot cross the server/client boundary). */
  lostHrefBase: string;
}) {
  const lostHref = (id: string) => `${lostHrefBase}&lead=${encodeURIComponent(id)}`;
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overQuoted, setOverQuoted] = useState(false);

  const moveToContacted = (id: string) =>
    startTransition(async () => {
      const r = await updateLeadStatusAction(id, "CONTACTED");
      if (r.status === "success") {
        toast({ message: "Moved to Contacted" });
        router.refresh();
      } else if (r.status === "error") {
        toast({ message: r.message, tone: "danger" });
      }
    });

  const onDrop = (stage: BoardColumn["stage"]) => (e: React.DragEvent) => {
    e.preventDefault();
    setOverQuoted(false);
    const id = e.dataTransfer.getData("text/lead-id") || dragId;
    setDragId(null);
    if (!id) return;
    if (stage === "contacted") moveToContacted(id);
  };

  return (
    <div className="hidden lg:block">
    {dragId ? (
      <div
        role="button"
        aria-label="Drop to mark lost"
        className="mt-2 rounded-card border border-dashed border-danger px-4 py-3 text-center text-[15px] font-bold text-danger"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData("text/lead-id") || dragId;
          setDragId(null);
          if (id) router.push(lostHref(id));
        }}
      >
        Drop here to mark lost…
      </div>
    ) : null}
    <div className="mt-2 grid gap-3 lg:grid-cols-3">
      {columns.map((col) => (
        <section
          key={col.stage}
          aria-label={col.label}
          className="flex min-h-40 flex-col gap-2 rounded-card border border-line bg-tint/40 p-2"
          onDragOver={(e) => {
            if (col.stage === "quoted") {
              setOverQuoted(true);
              return;
            }
            e.preventDefault();
          }}
          onDragLeave={() => col.stage === "quoted" && setOverQuoted(false)}
          onDrop={col.stage === "quoted" ? undefined : onDrop(col.stage)}
        >
          <h2 className="px-1 text-sm font-bold text-ink">
            {col.label} <span className="font-semibold text-ink-soft">{col.cards.length}</span>
          </h2>
          {col.stage === "quoted" && overQuoted ? (
            <p className="rounded-field bg-surface px-2 py-1 text-sm font-semibold text-ink">
              Send a quote to move here
            </p>
          ) : null}
          {col.cards.map((card) => {
            const items: MenuItem[] = [
              { kind: "link", label: "Open", href: `/desk/leads/${card.id}` },
              ...(col.stage === "new"
                ? [
                    {
                      kind: "form",
                      label: "Mark as Contacted",
                      action: async () => moveToContacted(card.id),
                    } as MenuItem,
                  ]
                : []),
              { kind: "link", label: "Mark lost…", href: lostHref(card.id) },
            ];
            return (
              <article
                key={card.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/lead-id", card.id);
                  setDragId(card.id);
                }}
                onDragEnd={() => setDragId(null)}
                className="rounded-card border border-line bg-surface p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/desk/leads/${card.id}`} className="font-bold text-ink underline-offset-4 hover:underline">
                    {card.contactName}
                  </Link>
                  <span className="flex items-center gap-1">
                    <StatusPill label={String(card.score)} tone="neutral" />
                    <OverflowMenu items={items} label={`Actions for ${card.contactName}`} />
                  </span>
                </div>
                {card.line ? <p className="mt-0.5 text-sm text-ink-soft">{card.line}</p> : null}
                <p className="mt-1 text-sm text-ink-soft">{card.nextStep}</p>
              </article>
            );
          })}
          {col.cards.length === 0 ? (
            <p className="px-1 text-sm text-ink-soft">No leads here</p>
          ) : null}
        </section>
      ))}
    </div>
    </div>
  );
}
