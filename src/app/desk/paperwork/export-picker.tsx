"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

/**
 * VAULT-1: pick records and download the export pack (ZIP + PDF index,
 * numbers masked). The pack itself is built by /api/records/export, owner
 * only, and every export is audited there.
 */
export function ExportPicker({ records }: { records: { id: string; title: string }[] }) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const href = picked.size > 0 ? `/api/records/export?ids=${[...picked].join(",")}` : undefined;
  return (
    <div>
      <div className="grid gap-1 sm:grid-cols-2">
        {records.map((record) => (
          <label key={record.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={picked.has(record.id)}
              onChange={() => toggle(record.id)}
            />
            {record.title}
          </label>
        ))}
      </div>
      <div className="mt-3">
        {href ? (
          <a href={href} className="inline-block">
            <Button type="button">Download the export pack ({picked.size})</Button>
          </a>
        ) : (
          <Button type="button" disabled>
            Pick at least one record
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs text-ink-soft">
        The pack is a ZIP of each record&apos;s files plus an index. Numbers stay masked in the pack — full
        numbers never leave the app this way. Every export is written to the activity log.
      </p>
    </div>
  );
}
