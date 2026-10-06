/**
 * Shown while an /account/** page's data is loading. See
 * src/app/desk/loading.tsx's comment for why this exists.
 */
export default function AccountLoading() {
  return (
    <div className="max-w-2xl">
      <p role="status" className="sr-only">
        Loading…
      </p>
      <div className="animate-pulse" aria-hidden="true">
        <div className="h-6 w-40 rounded-control bg-canvas-alt" />
        <div className="mt-2 h-4 w-56 rounded-control bg-canvas-alt" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 rounded-card border border-line bg-surface" />
          ))}
        </div>
      </div>
    </div>
  );
}
