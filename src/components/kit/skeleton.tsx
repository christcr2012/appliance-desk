// AR-0 kit 4.16: loading placeholders for loading.tsx files. The pulse stops for people who ask for less motion.
import type { ReactNode } from "react";

export function Skeleton({ className = "h-4 w-40" }: { className?: string }) {
  return <span aria-hidden="true" data-skeleton className={`block animate-pulse rounded-field bg-tint motion-reduce:animate-none ${className}`} />;
}

function Loading({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** 6 cards on phones, 8 table rows on desktop. */
export function ListSkeleton({ label = "Loading…" }: { label?: string }) {
  return (
    <Loading label={label}>
      <ul className="flex flex-col gap-2.5 lg:hidden" data-testid="list-skeleton-phone">
        {Array.from({ length: 6 }, (_, index) => (
          <li key={index} className="rounded-card bg-surface px-4 py-3.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-3 w-24" />
          </li>
        ))}
      </ul>
      <div className="hidden rounded-card bg-surface lg:block" data-testid="list-skeleton-desktop">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="flex gap-6 border-b border-line px-4 py-3 last:border-b-0">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="ml-auto h-4 w-16" />
          </div>
        ))}
      </div>
    </Loading>
  );
}

export function RecordSkeleton({ label = "Loading…" }: { label?: string }) {
  return (
    <Loading label={label}>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-40" />
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-card" />
          ))}
        </div>
        <Skeleton className="h-40 w-full rounded-card" />
      </div>
    </Loading>
  );
}

export function InboxSkeleton({ label = "Loading…" }: { label?: string }) {
  return (
    <Loading label={label}>
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="rounded-card bg-surface px-4 py-3.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-5 w-56" />
            <Skeleton className="mt-2 h-3 w-40" />
            <div className="mt-3 flex gap-2">
              <Skeleton className="h-11 flex-1" />
              <Skeleton className="h-11 w-24" />
            </div>
          </div>
        ))}
      </div>
    </Loading>
  );
}
