"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/lib/auth-client";
import { ThemeToggle } from "@/components/theme-toggle";

export type AuthedNavLink = { href: string; label: string };

/**
 * Shared header for the owner desk (/desk/**) and customer portal
 * (/account/**): collapses into a hamburger-triggered menu below the
 * `md` breakpoint — the same pattern already used (and already
 * accessibility-tested) by the public site's header,
 * src/components/site/header.tsx.
 *
 * Fixes a real mobile bug (reported by Chris, 2026-09-27): both layouts
 * used to render their full nav — 11 links for the desk — as one plain
 * `flex` row with no wrapping and no way to collapse it. On a phone-width
 * screen that row is wider than the viewport, and since nothing
 * contained the overflow, the whole page scrolled sideways to show it.
 *
 * `variant` (added in the design pass following Chris's feedback,
 * 2026-09-27 — "it's just word links sitting on the pages"):
 * - "topnav" (default, used by /account/**, 4 links): a normal
 *   horizontal nav row on desktop, same as before, now with a visible
 *   current-page indicator instead of plain text links with no state.
 * - "sidebar" (used by /desk/**, 11 links — too many for a row to read
 *   as real navigation instead of a wall of text): this component
 *   renders MOBILE ONLY in this mode (the hamburger + slide-down menu,
 *   unchanged from before) and hides entirely at the `md` breakpoint —
 *   src/components/desk-sidebar.tsx takes over navigation on desktop
 *   instead, as a real sidebar with active-page highlighting.
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
  variant = "topnav",
}: {
  title: string;
  areaLabel: string;
  links: AuthedNavLink[];
  variant?: "topnav" | "sidebar";
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

  // A link is "active" on an exact match, or on a deeper page nested
  // under it (e.g. /desk/agreements stays highlighted on
  // /desk/agreements/abc123) — UNLESS another link in this same nav is
  // itself nested under this href (e.g. /account is only the
  // "Overview" page, not a real ancestor of sibling sections like
  // /account/rentals, even though the URL looks like a prefix).
  function isActive(href: string) {
    if (pathname === href) return true;
    const hrefIsAncestorOfSibling = links.some(
      (l) => l.href !== href && l.href.startsWith(`${href}/`),
    );
    if (hrefIsAncestorOfSibling) return false;
    return pathname.startsWith(`${href}/`);
  }

  return (
    <header
      ref={headerRef}
      // overflow-anchor:none (2026-09-29, Chris reported: opening the
      // menu while scrolled down the page closed it again almost
      // instantly) — opening the menu inserts a tall panel right below
      // this header, which grows the header's own height. If the page
      // isn't scrolled to the top, browsers "scroll anchor" to keep
      // whatever's on screen from visually jumping — they nudge scrollY
      // to compensate for that inserted height, which is a completely
      // real `scroll` event. The onScroll listener above (added so the
      // menu closes if you scroll the page behind it) can't tell that
      // apart from an actual user scroll, so it closed the menu the
      // instant it opened. This tells the browser not to compensate for
      // size changes inside this header at all, which is exactly the
      // documented purpose of overflow-anchor — see
      // https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-anchor
      className={`[overflow-anchor:none] border-b bg-white ${variant === "sidebar" ? "md:hidden" : ""}`}
    >
      <div className="flex items-center justify-between px-6 py-4">
        <span className="font-semibold">{title}</span>

        {/* Desktop nav — only in the "topnav" variant; "sidebar" hides
            this whole header at md: and above (see desk-sidebar.tsx). */}
        {variant === "topnav" && (
          <nav
            aria-label={areaLabel}
            className="hidden items-center gap-4 text-sm md:flex"
          >
            {links.map((link) => {
              const active = isActive(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "font-semibold text-primary"
                      : "text-gray-600 hover:text-gray-900"
                  }
                >
                  {link.label}
                </Link>
              );
            })}
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="text-gray-600 hover:text-gray-900 disabled:opacity-60"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
            <ThemeToggle />
          </nav>
        )}

        {/* Mobile menu toggle */}
        <div className="flex items-center gap-1 md:hidden">
          <ThemeToggle />
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md p-2 text-gray-700"
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
      </div>

      {/* Mobile menu panel. max-h + overflow-y-auto + overscroll-contain
          (2026-09-28, Chris reported: "some of them are longer and if I
          try to scroll the menu, it just closes it") — the desk nav has
          11 links, which no longer fits one phone screen, and this panel
          isn't sticky/fixed, so a finger-drag to scroll through the rest
          of it was moving the whole page, which the onScroll listener
          above (added to close the menu when scrolling the page behind
          it) treated exactly like a real page scroll and closed the menu
          before the drag finished. Capping the panel's own height and
          letting IT scroll internally means a scroll gesture inside the
          menu never reaches window's scroll event at all, so it no
          longer gets closed by that listener; overscroll-contain stops
          the scroll from "chaining" into the page once you hit the
          bottom of the list, which would otherwise trigger the exact
          same false close right as you reach the end. */}
      {menuOpen && (
        <nav
          id="authed-mobile-menu"
          aria-label={areaLabel}
          className="max-h-[70dvh] overflow-y-auto overscroll-contain border-t bg-gray-50 md:hidden"
        >
          <div className="flex flex-col gap-1 px-4 py-3">
            {links.map((link) => {
              const active = isActive(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md px-2 py-3 text-base font-medium ${
                    active
                      ? "bg-primary-soft text-primary-dark"
                      : "text-gray-900 hover:bg-gray-100"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
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
