"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOut } from "@/lib/auth-client";
import { clearRememberedLists } from "./remember-list";
import { Icon } from "./icons";
import { Sheet } from "./sheet";
import type { ProfileLink } from "@/lib/desk-areas";

export type ProfileUser = { name: string; email: string; role: string; initials: string };
const ROLE_LABEL: Record<string, string> = {
  OWNER: "Owner", ADMIN: "Admin", STAFF: "Staff", ACCOUNTANT: "Accountant",
};
const linkClass = "flex min-h-11 w-full items-center rounded-field px-3 text-left text-sm font-semibold hover:bg-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

export function ProfileMenu({ user, links, mobile = false }: {
  user: ProfileUser; links: ProfileLink[]; mobile?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    setBusy(true); setError("");
    try {
      const result = await signOut();
      if (result.error) throw new Error("Sign out failed");
      // Tab-owned filters and offline routes belong to the previous user, never the next one.
      try {
        if ("indexedDB" in window) indexedDB.deleteDatabase("desk-route");
        localStorage.removeItem("desk.recent");
        sessionStorage.removeItem("desk.inboxCount");
      } catch { /* storage denied */ }
      clearRememberedLists();
      router.push("/login");
      router.refresh();
    } catch {
      setError("Couldn't sign out. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const heading = <div className="border-b border-line px-3 py-3 text-sm">
    <p className="font-bold">{user.name}</p>
    <p className="break-all text-ink-soft">{user.email}</p>
    <p className="text-xs text-ink-soft">{ROLE_LABEL[user.role] ?? user.role}</p>
  </div>;
  const footer = <>
    <div className="border-t border-line px-3 py-2"><ThemeToggle /></div>
    <button type="button" className={linkClass} disabled={busy} onClick={logout}>
      <Icon name="signout" /><span className="ml-2">{busy ? "Signing out…" : "Sign out"}</span>
    </button>
    {error && <p role="alert" className="p-3 text-sm text-danger">{error}</p>}
  </>;

  if (mobile) {
    return <>
      <button type="button" aria-label="Profile" aria-expanded={open} onClick={() => setOpen(true)}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-on-primary">
        {user.initials}
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={user.name}>
        {heading}
        <nav aria-label="Account and settings" className="py-2">
          {links.map(link =>
            <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className={linkClass}>
              {link.label}
            </Link>
          )}
        </nav>
        {footer}
      </Sheet>
    </>;
  }
  return <DropdownMenu.Root open={open} onOpenChange={setOpen}>
    <DropdownMenu.Trigger asChild>
      <button type="button" aria-label="Profile menu" className="flex min-h-11 w-full items-center gap-3 rounded-field px-2 text-left hover:bg-white/10">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-on-primary">
          {user.initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{user.name}</span>
          <span className="block truncate text-xs">{ROLE_LABEL[user.role] ?? user.role}</span>
        </span>
        <Icon name="more" />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content align="start" side="top" sideOffset={8}
        aria-label="Account and settings"
        className="z-50 max-h-[80dvh] w-[260px] overflow-y-auto rounded-card border border-line bg-surface p-1 text-ink shadow-raise">
        {heading}
        {links.map(link => <DropdownMenu.Item key={link.href} asChild>
          <Link href={link.href} className={linkClass}>{link.label}</Link>
        </DropdownMenu.Item>)}
        <DropdownMenu.Separator className="my-1 border-t border-line" />
        {footer}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
