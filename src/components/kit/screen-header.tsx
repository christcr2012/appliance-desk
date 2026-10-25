// AR-0 kit 4.1: the top of every list/area screen. No description prop, on purpose (guard 9.1): help goes in an InfoTip.
import Link from "next/link";
import { ActionButton } from "./action-button";
import { Fab } from "./fab";
import { Icon } from "./icons";
import { OverflowMenu } from "./overflow-menu";
import type { ActionSpec, MenuItem } from "./types";

export type ScreenHeaderProps = {
  title: string;
  count?: number;
  primary?: ActionSpec;
  overflow?: MenuItem[];
  back?: { href: string; label: string };
  /** A list screen: on phones `primary` becomes the round Fab instead of a header button. */
  list?: boolean;
};

export function ScreenHeader({ title, count, primary, overflow, back, list = false }: ScreenHeaderProps) {
  return (
    <header className="flex flex-col gap-1 pb-4">
      {back ? (
        <Link
          href={back.href}
          aria-label={back.label}
          className="-ml-3 inline-flex h-11 w-11 items-center justify-center rounded-field text-ink hover:bg-tint lg:hidden"
        >
          <Icon name="back" size={24} />
        </Link>
      ) : null}
      <div className="flex items-center gap-3">
        <h1 className="min-w-0 flex-1 text-[28px] leading-8 font-extrabold tracking-[-0.5px] text-ink lg:text-[26px]" tabIndex={-1}>
          {title}
          {count !== undefined ? (
            <span className="ml-2 align-middle text-base font-bold text-ink-soft tabular-nums">{count}</span>
          ) : null}
        </h1>
        {primary ? (
          <div className={list ? "hidden lg:block" : undefined}>
            <ActionButton spec={primary} variant="primary" icon={list ? "plus" : undefined} />
          </div>
        ) : null}
        {overflow && overflow.length > 0 ? <OverflowMenu items={overflow} label={`More for ${title}`} /> : null}
      </div>
      {primary && list ? <Fab spec={primary} /> : null}
    </header>
  );
}
