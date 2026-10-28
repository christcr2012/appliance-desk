// AR-9 (INSIGHTS section 8): the one chart in the kit. Vertical bars for up
// to two series, 120px tall, with the same numbers in a visually hidden
// table for screen readers. No library. Value labels appear on hover and
// on keyboard focus (each bar is focusable). Server component: callers
// pass a plain format function.
export type MiniBarsSeries = { label: string; values: number[] };

export function MiniBars({
  series,
  labels,
  format,
}: {
  series: MiniBarsSeries[];
  labels: string[];
  format: (value: number) => string;
}) {
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const barTone = ["bg-primary", "bg-ink-soft"];
  return (
    <div>
      <div aria-hidden="true" className="flex items-end gap-2" style={{ height: 120 }}>
        {labels.map((label, i) => (
          <div key={`${label}-${i}`} className="flex flex-1 items-end justify-center gap-1" style={{ height: 120 }}>
            {series.map((s, si) => {
              const value = s.values[i] ?? 0;
              return (
                <div
                  key={s.label}
                  tabIndex={0}
                  title={`${label} — ${s.label}: ${format(value)}`}
                  className={`group relative w-full max-w-8 rounded-t ${barTone[si] ?? "bg-ink-soft"}`}
                  style={{ height: `${Math.max(value > 0 ? 4 : 0, (value / max) * 112)}px` }}
                >
                  <span className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 text-[11px] whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus:opacity-100">
                    {format(value)}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="mt-1 flex gap-2">
        {labels.map((label, i) => (
          <div key={`${label}-x-${i}`} className="flex-1 text-center text-[11px] text-ink-soft">
            {label}
          </div>
        ))}
      </div>
      {series.length > 1 && (
        <div aria-hidden="true" className="mt-2 flex gap-4 text-xs text-ink-soft">
          {series.map((s, si) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span className={`inline-block h-2.5 w-2.5 rounded-sm ${barTone[si] ?? "bg-ink-soft"}`} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <table className="sr-only">
        <caption>Chart data</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {series.map((s) => (
              <th key={s.label} scope="col">{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((label, i) => (
            <tr key={`${label}-row-${i}`}>
              <th scope="row">{label}</th>
              {series.map((s) => (
                <td key={s.label}>{format(s.values[i] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
