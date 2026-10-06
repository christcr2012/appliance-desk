/**
 * Shown while a /desk/** page's data is loading (Next.js's loading.tsx
 * convention) — the sidebar/nav in desk/layout.tsx stays visible and
 * interactive; only this content area appears while the page loads.
 * Added in the design review pass (2026-09-27): pages here pull from
 * the database on every visit, so on a slower connection the content
 * area would otherwise just be blank for a moment, which can read as
 * "did that click work?" rather than "this is loading."
 *
 * `animate-pulse` is a CSS animation, so it's already silenced by the
 * app-wide `prefers-reduced-motion` rule in globals.css.
 */
export default function DeskLoading() {
  return (
    <div>
      <p role="status" className="sr-only">
        Loading…
      </p>
      <div className="animate-pulse" aria-hidden="true">
        <div className="h-6 w-40 rounded bg-canvas-alt" />
        <div className="mt-2 h-4 w-72 rounded bg-canvas-alt" />
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-lg border border-line bg-white" />
          ))}
        </div>
        <div className="mt-6 h-64 rounded-lg border border-line bg-white" />
      </div>
    </div>
  );
}
