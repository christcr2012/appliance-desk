import Link from "next/link";
import type { ComponentType, ReactNode } from "react";

export type BottomTab = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

export function BottomTabBar({
  tabs,
  activeHref,
  moreAction,
}: {
  tabs: BottomTab[];
  activeHref: string;
  moreAction?: ReactNode;
}) {
  const columns = tabs.length + (moreAction ? 1 : 0);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-surface px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden print:hidden"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active =
          activeHref === tab.href || activeHref.startsWith(`${tab.href}/`);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 flex-col items-center justify-center gap-1 rounded-control px-1 text-xs font-semibold ${
              active ? "bg-action text-on-action" : "text-ink"
            }`}
          >
            <Icon className="h-5 w-5" />
            <span>{tab.label}</span>
          </Link>
        );
      })}
      {moreAction}
    </nav>
  );
}
