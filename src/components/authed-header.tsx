"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/lib/auth-client";

export type AuthedNavLink = { href: string; label: string };

/**
 * Shared header for the owner desk (/desk/**) and customer portal
 * (/account/**): a full nav row on desktop, collapsing into a
 * hamburger-triggered menu below the `md` breakpoint — the same pattern
 * already used (and already accessibility-tested) by the public site's
 * header, src/components/site/header.tsx.
 *
 * Fixes a real mobile bug (reported by Chris, 2026-09-27): both layouts
 * used to render their full nav — 11 links for the desk — as one plain
 * `flex` row with no wrapping and no way to collapse it. On a phone-width
 * screen that row is wider than the viewport, and since nothing
 * contained the overflow, the whole page scrolled sideways to show it.
 *
 * Accessibility (docs/DESIGN-SYSTEM.md), matching the public header:
 * the toggle button has aria-expanded/aria-controls and an accessible
 * name that changes with state, Escape and clicking outside close the
 * menu, and the mobile panel is real markup, not hidden via display
 * tricks, so it stays reachable by keyboard and screen readers.
 */
export function AuthedHeader({
  title,
  areaLabel,
  links,
}: {
  title: string;
  areaLabel: string;
  links: AuthedNavLink[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const headerRef = useRef<HTMLElement>(null);

  // Chris asked (2026-09-27): every signed-in page needs a way to sign
  // out — there wasn't one anywhere in the desk or the customer portal.
  // Shared here since both layouts render this one header.
  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    router.push("/login");
    router.refresh();
  }

  // Close the mobile menu on route change — adjusting state during
  // rendering when a prop changes, per
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMenuOpen(false);
  }

  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onScroll() {
      setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll);
    };
  }, [menuOpen]);

  return (
    <header ref={headerRef} className="border-b bg-white">
      <div className="flex items-center justify-between px-6 py-4">
        <span className="font-semibold">{title}</span>

        {/* Desktop nav */}
        <nav aria-label={areaLabel} className="hidden items-center gap-4 text-sm md:flex">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="text-gray-600 hover:text-gray-900">
              {link.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="text-gray-600 hover:text-gray-900 disabled:opacity-60"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </nav>

        {/* Mobile menu toggle */}
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md p-2 text-gray-700 md:hidden"
          aria-expanded={menuOpen}
          aria-controls="authed-mobile-menu"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          ) : (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile menu panel */}
      {menuOpen && (
        <nav id="authed-mobile-menu" aria-label={areaLabel} className="border-t bg-gray-50 md:hidden">
          <div className="flex flex-col gap-1 px-4 py-3">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-2 py-3 text-base font-medium text-gray-900 hover:bg-gray-100"
              >
                {link.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="rounded-md px-2 py-3 text-left text-base font-medium text-gray-900 hover:bg-gray-100 disabled:opacity-60"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </nav>
      )}
    </header>
  );
}
