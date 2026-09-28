"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/lib/auth-client";
import { ThemeToggle } from "@/components/theme-toggle";
import type { AuthedNavLink } from "@/components/authed-header";

/**
 * The owner desk's desktop (md: and up) navigation — a real sidebar,
 * not a row of plain text links. Built in response to Chris's direct
 * feedback (2026-09-27): "the design of the owner section... it's just
 * word links sitting on the pages." The 11-item nav previously used the
 * exact same plain-text-row treatment as the 4-item customer portal
 * nav, which was fine for 4 links but read as a wall of unstructured
 * text at 11 — with no visual container, no active-page indicator, and
 * no separation from the page content beneath it.
 *
 * Below the `md` breakpoint, AuthedHeader (rendered by desk/layout.tsx
 * alongside this component, with variant="sidebar") still handles
 * navigation via its existing, already-accessibility-tested hamburger
 * menu — this component renders nothing there (`hidden md:flex`).
 */
export function DeskSidebar({
  title,
  links,
}: {
  title: string;
  links: AuthedNavLink[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    router.push("/login");
    router.refresh();
  }

  // See authed-header.tsx's isActive for why sibling hrefs matter here
  // too — no desk link currently nests under another, but this keeps
  // both navs' active-page logic identical rather than silently
  // diverging.
  function isActive(href: string) {
    if (pathname === href) return true;
    const hrefIsAncestorOfSibling = links.some(
      (l) => l.href !== href && l.href.startsWith(`${href}/`),
    );
    if (hrefIsAncestorOfSibling) return false;
    return pathname.startsWith(`${href}/`);
  }

  return (
    <aside className="hidden border-r border-gray-200 bg-white md:flex md:w-60 md:shrink-0 md:flex-col">
      <Link
        href={links[0]?.href ?? "/desk/dashboard"}
        className="px-5 py-5 font-display text-lg font-semibold text-ink"
      >
        {title}
      </Link>

      <nav aria-label="Owner desk" className="flex flex-1 flex-col gap-0.5 px-3">
        {links.map((link) => {
          const active = isActive(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-primary-soft text-primary-dark"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center justify-between border-t border-gray-200 px-4 py-4">
        <ThemeToggle />
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-60"
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </aside>
  );
}
