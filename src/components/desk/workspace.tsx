import Link from "next/link";
import type { ReactNode } from "react";

export const primaryActionClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-action px-4 py-2 text-sm font-semibold text-on-action hover:opacity-90";
export const secondaryActionClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-control bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-subtle";

export function PageHeader({
  title,
  description,
  primaryAction,
  secondaryActions,
}: {
  title: string;
  description?: ReactNode;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:flex-wrap">
      <div className="min-w-0 w-full sm:min-w-64 sm:w-auto sm:flex-1">
        <h1 className="break-words text-[28px] leading-9 font-semibold text-ink">
          {title}
        </h1>
        {description && (
          <div className="mt-2 max-w-2xl text-sm leading-6 text-ink-soft">
            {description}
          </div>
        )}
      </div>
      {(primaryAction || secondaryActions) && (
        <div className="flex flex-wrap items-center gap-2">
          {secondaryActions}
          {primaryAction}
        </div>
      )}
    </header>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg leading-7 font-semibold text-ink">{title}</h2>
          {description && (
            <p className="mt-1 text-sm text-ink-soft">{description}</p>
          )}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg bg-subtle p-5 text-sm">
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="mt-2 text-ink-soft">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function FilterBar({
  label,
  items,
}: {
  label: string;
  items: { href: string; label: string; active: boolean }[];
}) {
  return (
    <nav aria-label={label} className="mb-6 flex flex-wrap gap-2">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={item.active ? primaryActionClass : secondaryActionClass}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function Metric({
  label,
  value,
  href,
  basis,
}: {
  label: string;
  value: number;
  href: string;
  basis: string;
}) {
  return (
    <Link
      href={href}
      className="min-w-0 rounded-xl border border-line bg-surface p-4 hover:bg-subtle"
    >
      <span className="block text-sm font-medium text-ink-soft">{label}</span>
      <span className="mt-1 block text-3xl font-semibold tabular-nums text-ink">
        {value}
      </span>
      <span className="mt-1 block text-xs text-ink-soft">{basis}</span>
    </Link>
  );
}
