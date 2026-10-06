"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { GlobalSearchBox } from "@/components/global-search-box";
import {
  ApplianceServiceIcon,
  BillingServiceIcon,
  CalendarServiceIcon,
  CustomersServiceIcon,
  DeliveryServiceIcon,
  MenuServiceIcon,
} from "@/components/icons/service-icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOut } from "@/lib/auth-client";
import {
  activeDeskHref,
  deskBottomTabLinks,
  type DeskNavGroup,
} from "@/lib/desk-navigation";
import {
  BottomTabBar,
  type BottomTab,
} from "@/components/ui/bottom-tab-bar";
import { Button, ButtonLink } from "@/components/ui/button";

const TAB_ICONS: Record<string, BottomTab["icon"]> = {
  "/desk/today": CalendarServiceIcon,
  "/desk/dispatch": DeliveryServiceIcon,
  "/desk/customers": CustomersServiceIcon,
  "/desk/billing": BillingServiceIcon,
  "/desk/jobs": CalendarServiceIcon,
  "/desk/inventory": ApplianceServiceIcon,
};

function headingId(label: string) {
  return `desk-nav-${label.toLowerCase().replaceAll(" ", "-").replaceAll("&", "and")}`;
}

function Navigation({
  nav,
  pathname,
  close,
}: {
  nav: DeskNavGroup[];
  pathname: string;
  close?: () => void;
}) {
  const active = activeDeskHref(pathname, nav);

  return (
    <nav aria-label="Owner desk" className="space-y-5 px-3 py-4">
      {nav.map((group) => {
        const id = headingId(group.label);
        return (
          <section key={group.label} aria-labelledby={id}>
            <h2
              id={id}
              className="px-3 text-xs font-semibold uppercase tracking-wide text-nav-ink"
            >
              {group.label}
            </h2>
            <ul className="mt-2 space-y-1">
              {group.links.map((link) => {
                const current = active === link.href;
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      onClick={close}
                      aria-current={current ? "page" : undefined}
                      className={`flex min-h-11 items-center rounded-control px-3 py-2 text-sm font-semibold ${
                        current
                          ? "bg-nav-current-bg text-nav-current-ink"
                          : "text-nav-ink hover:bg-surface hover:text-ink"
                      }`}
                    >
                      {link.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}

export function AppShell({
  nav,
  role,
  children,
}: {
  nav: DeskNavGroup[];
  role: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = activeDeskHref(pathname, nav) ?? pathname;
  const current =
    nav.flatMap((group) => group.links).find((link) => link.href === active)
      ?.label ?? "Appliance Desk";
  const tabs = deskBottomTabLinks(role, nav).map((link) => ({
    ...link,
    icon: TAB_ICONS[link.href] ?? CalendarServiceIcon,
  }));

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

  const moreAction = (
    <button
      type="button"
      aria-label="More navigation"
      aria-haspopup="dialog"
      aria-controls="desk-mobile-menu"
      onClick={(event) => openMenu(event.currentTarget)}
      className="flex min-h-11 flex-col items-center justify-center gap-1 rounded-control px-1 text-xs font-semibold text-ink"
    >
      <MenuServiceIcon className="h-5 w-5" />
      <span>More</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-canvas lg:pl-64 print:block print:bg-white print:pl-0">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-nav-bg text-nav-ink lg:flex print:hidden">
        <Link
          href="/desk/today"
          className="flex min-h-16 items-center gap-3 px-5 py-4"
        >
          <Image
            src="/brand/mark.svg"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8"
          />
          <span className="font-semibold">Appliance Desk</span>
        </Link>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Navigation nav={nav} pathname={pathname} />
        </div>
        <div className="space-y-3 border-t border-line p-4">
          <GlobalSearchBox />
          <div className="flex items-center justify-between gap-3">
            <ThemeToggle />
            <Button
              variant="secondary"
              onClick={handleSignOut}
              disabled={signingOut}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="flex min-h-16 items-center gap-3 border-b border-line bg-surface px-4 lg:hidden print:hidden">
          <Image
            src="/brand/mark.svg"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8"
          />
          <span className="min-w-0 flex-1 truncate font-semibold text-ink">
            {current}
          </span>
          <ButtonLink
            href="/desk/search"
            variant="quiet"
            aria-label="Search"
          >
            Search
          </ButtonLink>
        </header>

        {error && (
          <p
            role="alert"
            className="px-4 py-3 text-sm font-semibold text-danger print:hidden"
          >
            {error}
          </p>
        )}

        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto min-w-0 max-w-screen-2xl p-4 pb-28 sm:p-6 lg:p-8 lg:pb-8 print:max-w-none print:p-0"
        >
          {children}
        </main>
      </div>

      <BottomTabBar
        tabs={tabs}
        activeHref={active}
        moreAction={moreAction}
      />

      <dialog
        ref={dialog}
        id="desk-mobile-menu"
        aria-labelledby="desk-menu-title"
        onClose={() => trigger.current?.focus()}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeMenu();
        }}
        className="fixed inset-0 m-0 h-dvh max-h-dvh w-80 max-w-full bg-nav-bg p-0 text-nav-ink backdrop:bg-ink/50 lg:hidden print:hidden"
      >
        <div className="flex h-full flex-col">
          <div className="flex min-h-16 items-center justify-between gap-3 border-b border-line px-4">
            <h2 id="desk-menu-title" className="font-semibold">
              Appliance Desk
            </h2>
            <Button variant="secondary" onClick={closeMenu}>
              Close
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <Navigation nav={nav} pathname={pathname} close={closeMenu} />
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-line p-4">
            <ThemeToggle />
            <Button
              variant="secondary"
              onClick={handleSignOut}
              disabled={signingOut}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
