"use client";
// AR-12: task guidance without inventing an action or running one on the user's behalf.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { DataTable, EmptyState, ScreenHeader, Sheet } from "@/components/kit";
import { searchHelpGuides, type HelpGuide } from "@/lib/help-guides";

export function HelpGuidesList({ guides }: { guides: HelpGuide[] }) {
  const [search, setSearch] = useState("");
  const router = useRouter();
  const params = useSearchParams();
  const rows = searchHelpGuides(guides, search);
  const selected = guides.find(guide => guide.id === params.get("guide")) ?? null;
  const hrefFor = (id: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("guide", id);
    return `/desk/help?${next.toString()}`;
  };
  const close = () => {
    const next = new URLSearchParams(params.toString());
    next.delete("guide");
    router.replace(next.size ? `/desk/help?${next.toString()}` : "/desk/help", { scroll: false });
  };
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <ScreenHeader title="How do I…?" count={rows.length} />
      <label htmlFor="help-search" className="block max-w-xl text-sm font-bold text-ink">
        Search questions
        <input
          id="help-search" type="search" data-kit-search value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Try refund, driver, receipt…"
          className="mt-2 block min-h-11 w-full rounded-field border border-line-strong bg-surface px-4 text-[15px] font-normal text-ink"
        />
      </label>
      <DataTable
        caption="How-to guides"
        rows={rows}
        rowKey={guide => guide.id}
        panelParam="guide"
        selectedKey={selected?.id}
        columns={[
          { key: "question", header: "Question", cell: guide => guide.question },
          { key: "step", header: "Start here", cell: guide => guide.steps[0] },
        ]}
        mobileCard={guide => (
          <Link
            href={hrefFor(guide.id)} scroll={false}
            className="block min-h-11 py-1 text-ink focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <strong className="block text-base">{guide.question}</strong>
            <span className="mt-1 block text-sm text-ink-soft">{guide.steps[0]}</span>
          </Link>
        )}
        mobileCardLink={false}
        empty={<EmptyState title="No matching guides" />}
      />
      <Sheet
        open={selected !== null}
        onOpenChange={open => { if (!open) close(); }}
        title={selected?.question ?? "How-to guide"}
        footer={selected ? (
          <Link
            href={selected.href}
            className="inline-flex min-h-11 items-center rounded-field bg-primary px-4 text-sm font-bold text-on-primary"
          >Go there</Link>
        ) : undefined}
      >
        {selected ? (
          <ol className="list-decimal space-y-3 pl-6 text-[15px] text-ink">
            {selected.steps.map((step, i) => <li key={i} className="pl-1">{step}</li>)}
          </ol>
        ) : null}
      </Sheet>
    </div>
  );
}
