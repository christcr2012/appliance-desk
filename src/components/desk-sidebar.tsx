"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/lib/auth-client";
import { ThemeToggle } from "@/components/theme-toggle";
import { GlobalSearchBox } from "@/components/global-search-box";
import { activeDeskHref, type DeskNavGroup } from "@/lib/desk-navigation";
import {
  primaryActionClass,
  secondaryActionClass,
} from "@/components/desk/workspace";

function Navigation({
  groups,
  pathname,
  close,
}: {
  groups: DeskNavGroup[];
  pathname: string;
  close?: () => void;
}) {
  const active = activeDeskHref(pathname, groups);
  return (
    <nav aria-label="Owner desk" className="space-y-2 p-3">
      {groups.map((group) => (
        <details key={`${pathname}-${group.label}`} open className="rounded-lg">
          <summary className="min-h-11 cursor-pointer px-3 py-3 text-xs font-semibold tracking-wide text-ink-soft">
            {group.label}
          </summary>
          <ul className="space-y-1">
            {group.links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={close}
                  aria-current={active === link.href ? "page" : undefined}
                  className={`block min-h-11 rounded-lg px-3 py-3 text-sm font-medium ${active === link.href ? "bg-action text-on-action" : "text-ink hover:bg-subtle"}`}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </nav>
  );
}

/** Native modal supplies focus containment and Escape; scrolling the menu never closes it. */
export function DeskSidebar({
  groups,
  children,
}: {
  groups: DeskNavGroup[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = activeDeskHref(pathname, groups);
  const current =
    groups.flatMap((g) => g.links).find((l) => l.href === active)?.label ??
    "Appliance Desk";
  const canCreateRental = groups.some((g) =>
    g.links.some((l) => l.href === "/desk/settings"),
  );

  function openMenu(button: HTMLButtonElement) {
    trigger.current = button;
    dialog.current?.showModal();
  }
  function closeMenu() {
    dialog.current?.close();
  }

  useEffect(() => {
    dialog.current?.close();
  }, [pathname]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      if (desktop.matches) dialog.current?.close();
    };
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    setError(null);
    try {
      const result = await signOut();
      if (result.error) throw new Error("Sign out failed");
      router.push("/login");
      router.refresh();
    } catch {
      setError("Couldn't sign out. Please try again.");
      setSigningOut(false);
    }
  }
  const signOutButton = (
    <button
      type="button"
      disabled={signingOut}
      onClick={handleSignOut}
      className={secondaryActionClass}
    >
      {signingOut ? "Signing out…" : "Sign out"}
    </button>
  );

  return (
    <div className="min-h-screen bg-canvas lg:flex print:block print:bg-white">
      <aside className="print:hidden sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <Link
          href="/desk/today"
          className="px-6 py-5 text-lg font-semibold text-ink"
        >
          Appliance Desk
        </Link>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Navigation groups={groups} pathname={pathname} />
        </div>
        <div className="flex items-center justify-between border-t border-line p-4">
          <ThemeToggle />
          {signOutButton}
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="print:hidden flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Open menu"
              aria-haspopup="dialog"
              aria-controls="desk-mobile-menu"
              onClick={(e) => openMenu(e.currentTarget)}
              className={`${secondaryActionClass} lg:hidden`}
            >
              Menu
            </button>
            <span className="hidden font-semibold text-ink sm:block">
              {current}
            </span>
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-3">
            <GlobalSearchBox />
            <details
              key={pathname}
              className="relative"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.currentTarget.open = false;
                  e.currentTarget.querySelector("summary")?.focus();
                }
              }}
            >
              <summary className={`${primaryActionClass} cursor-pointer`}>
                Create
              </summary>
              <div className="absolute right-0 z-20 mt-2 w-48 rounded-xl border border-line bg-surface p-2 shadow-lg">
                {canCreateRental && (
                  <Link
                    href="/desk/agreements/new"
                    onClick={(e) =>
                      e.currentTarget
                        .closest("details")
                        ?.removeAttribute("open")
                    }
                    className="block min-h-11 rounded-lg p-3 text-sm text-ink hover:bg-subtle"
                  >
                    New rental
                  </Link>
                )}
                <Link
                  href="/desk/tasks#new-task"
                  onClick={(e) =>
                    e.currentTarget.closest("details")?.removeAttribute("open")
                  }
                  className="block min-h-11 rounded-lg p-3 text-sm text-ink hover:bg-subtle"
                >
                  Add task
                </Link>
              </div>
            </details>
          </div>
        </header>
        {error && (
          <p role="alert" className="print:hidden px-6 py-3 text-danger">
            {error}
          </p>
        )}
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto min-w-0 max-w-[1440px] p-4 pb-28 sm:p-6 sm:pb-28 lg:p-8 print:max-w-none print:p-0"
        >
          {children}
        </main>
      </div>
      <nav
        aria-label="Quick access"
        className="print:hidden fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden"
      >
        {[
          { href: "/desk/today", label: "Today" },
          { href: "/desk/tasks", label: "Tasks" },
          { href: "/desk/jobs", label: "Jobs" },
        ].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active === link.href ? "page" : undefined}
            className={`flex min-h-11 items-center justify-center rounded-lg text-sm font-medium ${active === link.href ? "bg-action text-on-action" : "text-ink"}`}
          >
            {link.label}
          </Link>
        ))}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-controls="desk-mobile-menu"
          onClick={(e) => openMenu(e.currentTarget)}
          className="min-h-11 rounded-lg text-sm font-medium text-ink"
        >
          More
        </button>
      </nav>
      <dialog
        ref={dialog}
        id="desk-mobile-menu"
        aria-labelledby="desk-menu-title"
        onClose={() => trigger.current?.focus()}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeMenu();
        }}
        className="print:hidden fixed inset-0 m-0 h-dvh max-h-dvh w-80 max-w-[90vw] border-r border-line bg-surface p-0 text-ink backdrop:bg-black/50"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-line p-4">
            <h2 id="desk-menu-title" className="font-semibold">
              Appliance Desk
            </h2>
            <button
              type="button"
              onClick={closeMenu}
              className={secondaryActionClass}
            >
              Close menu
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <Navigation groups={groups} pathname={pathname} close={closeMenu} />
          </div>
          <div className="flex items-center justify-between border-t border-line p-4">
            <ThemeToggle />
            {signOutButton}
          </div>
        </div>
      </dialog>
    </div>
  );
}
