"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ComponentType, type ReactNode } from "react";
import {
  ApplianceServiceIcon,
  BillingServiceIcon,
  CustomersServiceIcon,
  HomeServiceIcon,
  SupportServiceIcon,
} from "@/components/icons/service-icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { BottomTabBar, Button } from "@/components/ui";
import { signOut } from "@/lib/auth-client";

type AccountLink = {
  href: string;
  desktopLabel: string;
  mobileLabel: string;
  icon: ComponentType<{ className?: string }>;
};

const ACCOUNT_LINKS: AccountLink[] = [
  {
    href: "/account",
    desktopLabel: "Overview",
    mobileLabel: "Home",
    icon: HomeServiceIcon,
  },
  {
    href: "/account/rentals",
    desktopLabel: "My rentals",
    mobileLabel: "Rentals",
    icon: ApplianceServiceIcon,
  },
  {
    href: "/account/maintenance",
    desktopLabel: "Maintenance",
    mobileLabel: "Maintenance",
    icon: SupportServiceIcon,
  },
  {
    href: "/account/billing",
    desktopLabel: "Billing",
    mobileLabel: "Billing",
    icon: BillingServiceIcon,
  },
  {
    href: "/account/settings",
    desktopLabel: "Settings",
    mobileLabel: "Account",
    icon: CustomersServiceIcon,
  },
];

function activeFor(pathname: string, href: string) {
  if (href === "/account") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AccountShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      const result = await signOut();
      if (result.error) throw new Error("Sign out failed");
      router.push("/login");
      router.refresh();
    } catch {
      setSignOutError("Couldn't sign out. Please try again.");
      setSigningOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface print:hidden">
        <div className="mx-auto flex min-h-16 max-w-screen-2xl items-center gap-3 px-4 sm:px-6">
          <Link href="/account" className="flex min-h-11 items-center gap-3">
            <Image
              src="/brand/mark.svg"
              alt=""
              width={32}
              height={32}
              className="h-8 w-8"
            />
            <span className="font-semibold text-ink">My Account</span>
          </Link>

          <nav
            aria-label="My account"
            className="ml-auto hidden items-center gap-1 md:flex"
          >
            {ACCOUNT_LINKS.map((link) => {
              const active = activeFor(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex min-h-11 items-center rounded-control px-3 py-2 text-sm font-semibold ${
                    active
                      ? "bg-action text-on-action"
                      : "text-ink hover:bg-subtle"
                  }`}
                >
                  {link.desktopLabel}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2 md:ml-2">
            <ThemeToggle />
            <Button
              type="button"
              variant="quiet"
              disabled={signingOut}
              onClick={handleSignOut}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        </div>
        {signOutError && (
          <p
            role="alert"
            className="mx-auto max-w-screen-2xl px-4 pb-3 text-sm font-semibold text-danger sm:px-6"
          >
            {signOutError}
          </p>
        )}
      </header>

      <main
        id="main-content"
        className="mx-auto min-w-0 max-w-screen-2xl p-4 pb-28 sm:p-6 md:pb-8"
      >
        {children}
      </main>

      <div className="md:hidden print:hidden">
        <BottomTabBar
          tabs={ACCOUNT_LINKS.map((link) => ({
            href: link.href,
            label: link.mobileLabel,
            icon: link.icon,
          }))}
          activeHref={
            ACCOUNT_LINKS.find((link) => activeFor(pathname, link.href))?.href ??
            "/account"
          }
        />
      </div>
    </div>
  );
}
