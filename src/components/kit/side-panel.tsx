// AR-0 kit 4.6: the desktop record preview beside a list. Render it only when the page received ?open=<id>; it is
// shown at lg (≥1024 px) only. Close is a link (and the Escape key); "Open full page →" goes to the record page.
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./icons";
import { SidePanelEscape } from "./side-panel-escape";

export function SidePanel({
  title,
  closeHref,
  fullHref,
  children,
}: {
  title: string;
  closeHref: string;
  fullHref: string;
  children: ReactNode;
}) {
  return (
    <aside
      aria-label={title}
      className="hidden lg:sticky lg:top-0 lg:flex lg:max-h-dvh lg:w-[420px] lg:shrink-0 lg:flex-col lg:border-l lg:border-line lg:bg-surface"
    >
      <SidePanelEscape closeHref={closeHref}>
        <div className="flex items-center gap-3 border-b border-line px-5 py-3">
          <h2 className="min-w-0 flex-1 truncate text-base font-bold text-ink">{title}</h2>
          <Link
            href={closeHref}
            scroll={false}
            aria-label="Close"
            className="inline-flex h-10 w-10 items-center justify-center rounded-field text-ink-soft hover:bg-tint"
          >
            <Icon name="close" />
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <div className="border-t border-line px-5 py-3">
          <Link href={fullHref} className="inline-flex min-h-10 items-center text-[15px] font-bold text-primary hover:underline">
            Open full page →
          </Link>
        </div>
      </SidePanelEscape>
    </aside>
  );
}
