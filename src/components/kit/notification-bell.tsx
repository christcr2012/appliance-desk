"use client";
// AR-13: the notifications bell (NOTIFICATIONS.md section 6). Desktop shows an anchored popover,
// phones the kit Sheet; both render the same panel. The unread count follows the AR-11 freshness
// rule (refreshPermitted): fetched on mount, when the tab becomes visible again, and every 60 s
// only while the page is visible and the person used it in the last 10 minutes — an idle tab
// never keeps the database awake.
import { useKitWords } from "./words";
import * as Popover from "@radix-ui/react-popover";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NotificationKind } from "@prisma/client";
import { formatShortDate } from "@/lib/business-date";
import {
  getUnreadCountAction,
  listNotificationsAction,
  markAllReadAction,
  markReadAction,
  type NotificationRowDto,
} from "@/app/desk/notifications/actions";
import { Icon, type IconName } from "./icons";
import { Sheet } from "./sheet";
import { DESKTOP_QUERY, useMediaQuery } from "./use-media-query";
import { refreshPermitted } from "./auto-refresh";

const KIND_ICON: Record<NotificationKind, IconName> = {
  LEAD_NEW: "customers",
  QUOTE_VIEWED: "bill",
  SIGNATURE_DONE: "check",
  PAYMENT_FAILED: "money",
  APPROVAL_REQUESTED: "bell",
};

/** "just now", "5 min ago", "2 hr ago", then the short date (all Colorado time underneath). */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return formatShortDate(then, now);
}

const exactTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/Denver" });

const BELL_BUTTON =
  "relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-field text-ink hover:bg-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring lg:min-h-10 lg:min-w-10";

export function NotificationBell() {
  const words = useKitWords();
  const router = useRouter();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [count, setCount] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NotificationRowDto[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const lastInteraction = useRef(0);

  const loadCount = useCallback(() => {
    void getUnreadCountAction()
      .then(setCount)
      .catch(() => {
        // A failed count leaves the last known number; the next tick or open retries.
      });
  }, []);

  useEffect(() => {
    lastInteraction.current = Date.now();
    const bump = () => {
      lastInteraction.current = Date.now();
    };
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    events.forEach((name) => window.addEventListener(name, bump, { passive: true }));
    loadCount();
    const onVisible = () => {
      if (document.visibilityState === "visible") loadCount();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => {
      if (
        refreshPermitted({
          now: Date.now(),
          lastInteraction: lastInteraction.current,
          visible: document.visibilityState === "visible",
          online: navigator.onLine,
          blocked: false,
        })
      ) {
        loadCount();
      }
    }, 60_000);
    return () => {
      events.forEach((name) => window.removeEventListener(name, bump));
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [loadCount]);

  const loadFirstPage = useCallback(() => {
    setRows(null);
    void listNotificationsAction(null)
      .then((page) => {
        setRows(page.rows);
        setNextCursor(page.nextCursor);
      })
      .catch(() => setRows([]));
  }, []);

  const loadMore = () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    void listNotificationsAction(nextCursor)
      .then((page) => {
        setRows((current) => [...(current ?? []), ...page.rows]);
        setNextCursor(page.nextCursor);
      })
      .catch(() => {
        // Keep the rows already shown; the button stays for another try.
      })
      .finally(() => setLoadingMore(false));
  };

  const openRow = (row: NotificationRowDto) => {
    if (!row.readAt) {
      void markReadAction(row.id).catch(() => {});
      setRows((current) =>
        current?.map((r) => (r.id === row.id ? { ...r, readAt: new Date().toISOString() } : r)) ?? current,
      );
      setCount((current) => (current === null ? current : Math.max(0, current - 1)));
    }
    setOpen(false);
    router.push(row.href);
  };

  const markAll = () => {
    void markAllReadAction().catch(() => {});
    setRows((current) =>
      current?.map((r) => (r.readAt ? r : { ...r, readAt: new Date().toISOString() })) ?? current,
    );
    setCount(0);
  };

  const unread = count ?? 0;
  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";
  // The first page loads from the open gesture itself, not an effect (the panel starts empty
  // every time it opens, and an effect would pay a synchronous setState on each open).
  const openPanel = () => {
    setOpen(true);
    loadFirstPage();
  };

  const bellButton = (
    <button
      type="button"
      aria-label={label}
      onClick={desktop ? undefined : openPanel}
      className={BELL_BUTTON}
    >
      <Icon name="bell" />
      {unread > 0 ? (
        <span className="absolute right-0.5 top-0.5 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-bold leading-none text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </button>
  );

  const panel = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-1">
        {/* On phones the Sheet already heads the panel with this title. */}
        {desktop ? <span className="text-sm font-bold text-ink">Notifications</span> : <span />}
        {rows?.some((row) => !row.readAt) ? (
          <button
            type="button"
            onClick={markAll}
            className="inline-flex min-h-11 items-center rounded-field px-2 text-sm font-bold text-primary hover:bg-tint lg:min-h-10"
          >
            Mark all as read
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {rows === null ? (
          <p className="px-2 py-6 text-sm text-ink-soft">{words.loading}</p>
        ) : rows.length === 0 ? (
          <p className="px-2 py-6 text-sm text-ink-soft">Nothing new.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => openRow(row)}
                  className="flex w-full items-start gap-3 rounded-field px-2 py-3 text-left hover:bg-tint focus-visible:outline-2 focus-visible:outline-focus-ring"
                >
                  <span className="mt-0.5 shrink-0 text-ink-soft">
                    <Icon name={KIND_ICON[row.kind]} size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm text-ink ${row.readAt ? "" : "font-bold"}`}>
                      {row.title}
                    </span>
                    <span className="mt-0.5 block text-sm leading-snug text-ink-soft">{row.body}</span>
                    <span className="mt-0.5 block text-xs text-ink-faint" title={exactTime(row.createdAt)}>
                      {relativeTime(row.createdAt)}
                    </span>
                  </span>
                  {!row.readAt ? (
                    <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-danger" />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
        {nextCursor ? (
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="mt-1 inline-flex min-h-11 w-full items-center justify-center rounded-field text-sm font-bold text-primary hover:bg-tint disabled:opacity-60 lg:min-h-10"
          >
            {loadingMore ? words.loading : words.loadMore}
          </button>
        ) : null}
      </div>
      <div className="border-t border-line px-4 py-2">
        <Link
          href="/desk/account/notifications"
          onClick={() => setOpen(false)}
          className="inline-flex min-h-11 items-center rounded-field text-sm font-bold text-primary hover:bg-tint lg:min-h-10"
        >
          Choose what you get
        </Link>
      </div>
    </div>
  );

  if (!desktop) {
    return (
      <>
        {bellButton}
        <Sheet open={open} onOpenChange={setOpen} title="Notifications">
          {panel}
        </Sheet>
      </>
    );
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) loadFirstPage();
      }}
    >
      <Popover.Trigger asChild>{bellButton}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label="Notifications"
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={16}
          className="z-50 flex max-h-[70vh] w-[380px] max-w-[92vw] flex-col rounded-card border border-line bg-surface py-2 shadow-raise"
        >
          {panel}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
