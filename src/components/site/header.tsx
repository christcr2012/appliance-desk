"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Container } from "./container";
import { NAV_LINKS } from "./nav-links";

/**
 * Public-site header: sticky, with a full nav row on desktop and a
 * hamburger-triggered menu on mobile — the same pattern used by most
 * high-end small-business and SaaS marketing sites (a persistent, always-
 * reachable primary CTA plus a collapsible menu below a breakpoint).
 *
 * Accessibility (docs/DESIGN-SYSTEM.md): the toggle button has
 * aria-expanded/aria-controls and an accessible name that changes with
 * state, Escape closes the menu, and the mobile panel is real markup (not
 * hidden via display:none tricks) so it's reachable by keyboard and
 * screen readers alike.
 */
export function Header({ businessName }: { businessName: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);

  // Close the mobile menu on route change. Adjusting state during
  // rendering (rather than in a useEffect) when a prop changes is the
  // pattern React recommends for this — see
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

  // Chris reported (2026-09-26) that the mobile menu stayed open when
  // tapping outside it or scrolling the page — Escape and route-change
  // were the only things that closed it. Fixes both: a pointerdown
  // outside the header closes it, and so does any scroll while it's
  // open (the panel is a dropdown, not something meant to travel with
  // the page). Escape/route-change above are unaffected.
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
    <header
      ref={headerRef}
      className="sticky top-0 z-50 border-b border-line bg-canvas/90 backdrop-blur"
    >
      <Container className="flex h-18 items-center justify-between py-3">
        <Link
          href="/"
          className="font-display text-xl font-semibold tracking-tight text-ink"
        >
          {businessName}
        </Link>

        {/* Desktop nav */}
        <nav aria-label="Primary" className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.filter((l) => l.href !== "/contact").map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-ink-soft transition-colors hover:text-primary"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/login"
            className="text-sm font-medium text-ink-soft transition-colors hover:text-primary"
          >
            Log in
          </Link>
          <Link
            href="/contact"
            className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary shadow-sm transition-colors hover:bg-primary-dark"
          >
            Get a Quote
          </Link>
        </nav>

        {/* Mobile menu toggle */}
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md p-2 text-ink md:hidden"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? (
            <svg
              width="26"
              height="26"
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
              width="26"
              height="26"
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
      </Container>

      {/* Mobile menu panel */}
      {menuOpen && (
        <nav
          id="mobile-menu"
          aria-label="Primary"
          className="border-t border-line bg-surface md:hidden"
        >
          <Container className="flex flex-col gap-1 py-4">
            {NAV_LINKS.filter((l) => l.href !== "/contact").map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-2 py-3 text-base font-medium text-ink hover:bg-canvas-alt"
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/login"
              className="rounded-md px-2 py-3 text-base font-medium text-ink hover:bg-canvas-alt"
            >
              Log in
            </Link>
            <Link
              href="/contact"
              className="mt-2 inline-flex items-center justify-center rounded-full bg-primary px-5 py-3 text-base font-semibold text-on-primary shadow-sm"
            >
              Get a Quote
            </Link>
          </Container>
        </nav>
      )}
    </header>
  );
}
