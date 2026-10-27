// AR-0 kit 4.7: the top of a record page, and the strip of key numbers under it.
import Link from "next/link";
import { RecordTitleTransition } from "./record-title-transition";
import { ActionButton } from "./action-button";
import { GlossaryPopover } from "./glossary-popover";
import { Icon } from "./icons";
import { OverflowMenu } from "./overflow-menu";
import { StatusPill } from "./status-pill";
import type { ActionSpec, GlossaryKey, MenuItem, Tone } from "./types";

export type RecordHeaderProps = {
  title: string;
  /** Matches the list row id for native page-to-page title motion; no animation without a matching row. */
  transitionId?: string;
  pills?: { label: string; tone: Tone; info?: GlossaryKey }[];
  subtitle?: string;
  contact?: { phone?: string; email?: string; address?: string };
  primary?: ActionSpec;
  actions?: ActionSpec[];
  overflow?: MenuItem[];
  back: { href: string; label: string };
};

export function mapHref(address: string): string {
  return `https://maps.google.com/?q=${encodeURIComponent(address)}`;
}

const QUICK =
  "flex min-h-14 flex-col items-center justify-center gap-1 rounded-field border border-line bg-surface text-sm font-bold text-ink hover:bg-tint";

/**
 * The phone bottom bar's actions for a record page (KIT 5.2 renders `<ActionBar actions={recordBarActions(…)} />` at
 * the end of the page): `primary` first, then `actions`, at most two. RecordHeader puts any others in its phone ⋯ menu.
 */
export function recordBarActions(primary: ActionSpec | undefined, actions: ActionSpec[] = []): ActionSpec[] {
  return [...(primary ? [{ ...primary, primary: true }] : []), ...actions].slice(0, 2);
}

export function RecordHeader({ title, transitionId, pills = [], subtitle, contact, primary, actions = [], overflow = [], back }: RecordHeaderProps) {
  const all = [...(primary ? [primary] : []), ...actions];
  // Phones show at most two actions in the bottom bar; any others join the phone ⋯ menu.
  const phoneOverflow: MenuItem[] = [...all.slice(2), ...overflow];
  const contactLine = [contact?.phone, contact?.email, contact?.address].filter(Boolean).join(" · ");
  return (
    <header className="flex flex-col gap-3 pb-4">
      {/* Phone top row: back chevron and ⋯ */}
      <div className="flex items-center justify-between lg:hidden">
        <Link
          href={back.href}
          aria-label={back.label}
          className="-ml-3 inline-flex h-11 w-11 items-center justify-center rounded-field text-ink hover:bg-tint"
        >
          <Icon name="back" size={24} />
        </Link>
        <OverflowMenu items={phoneOverflow} label={`More for ${title}`} />
      </div>
      {/* Desktop breadcrumb */}
      <nav aria-label="Breadcrumb" className="hidden text-sm text-ink-soft lg:block">
        <Link href={back.href} className="font-semibold hover:text-ink hover:underline">
          {back.label}
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page" className="text-ink">
          {title}
        </span>
      </nav>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {transitionId ? (
              <RecordTitleTransition id={transitionId}>
                <h1 tabIndex={-1} className="text-[26px] leading-8 font-extrabold tracking-[-0.5px] text-ink lg:text-[30px] lg:leading-9">
                  {title}
                </h1>
              </RecordTitleTransition>
            ) : (
              <h1 tabIndex={-1} className="text-[26px] leading-8 font-extrabold tracking-[-0.5px] text-ink lg:text-[30px] lg:leading-9">
                {title}
              </h1>
            )}
            {pills.map((pill) => (
              <StatusPill key={pill.label} label={pill.label} tone={pill.tone} info={pill.info} />
            ))}
          </div>
          {subtitle ? <p className="mt-1 text-sm text-ink-soft">{subtitle}</p> : null}
          {contactLine ? <p className="mt-1 hidden text-sm text-ink-soft lg:block">{contactLine}</p> : null}
        </div>
        <div className="hidden shrink-0 items-center gap-2 lg:flex">
          {actions.map((spec) => (
            <ActionButton key={`${spec.kind}-${spec.label}`} spec={spec} variant="secondary" />
          ))}
          {primary ? <ActionButton spec={primary} variant="primary" /> : null}
          <OverflowMenu items={overflow} label={`More for ${title}`} />
        </div>
      </div>
      {contact && (contact.phone || contact.email || contact.address) ? (
        <div className="grid grid-cols-3 gap-2 lg:hidden">
          {contact.phone ? (
            <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className={QUICK}>
              <Icon name="phone" />
              Call
            </a>
          ) : null}
          {contact.email ? (
            <a href={`mailto:${contact.email}`} className={QUICK}>
              <Icon name="email" />
              Email
            </a>
          ) : null}
          {contact.address ? (
            <a href={mapHref(contact.address)} target="_blank" rel="noopener noreferrer" className={QUICK}>
              <Icon name="map" />
              Map
            </a>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}

export type StatItem = { label: string; value: string; tone?: Tone; info?: GlossaryKey };

/** Phone: two columns inside one card. Desktop: up to five equal cards in a row. */
export function StatStrip({ items }: { items: StatItem[] }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, 5);
  return (
    <dl
      className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-card bg-surface px-4 py-3.5 lg:grid-flow-col lg:auto-cols-fr lg:grid-cols-none lg:gap-3 lg:bg-transparent lg:p-0"
    >
      {shown.map((item) => (
        <div key={item.label} className="min-w-0 lg:rounded-card lg:border lg:border-line lg:bg-surface lg:px-4 lg:py-3.5">
          <dt className="flex items-center gap-1 text-xs font-bold text-ink-soft">
            {item.label}
            {item.info ? (
              <GlossaryPopover
                term={item.info}
                triggerLabel={`What does ${item.label} mean?`}
                triggerClassName="relative inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-soft before:absolute before:-inset-3 before:content-[''] hover:text-ink"
                trigger={<Icon name="info" className="h-4 w-4" />}
              />
            ) : null}
          </dt>
          <dd
            data-tone={item.tone ?? "neutral"}
            className={`mt-0.5 text-lg font-extrabold tabular-nums lg:text-[22px] ${item.tone === "attention" ? "text-warning-ink" : item.tone === "danger" ? "text-danger" : item.tone === "good" ? "text-success" : "text-ink"}`}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
