"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useActionState, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/kit/icons";
import { Toaster } from "@/components/kit/toaster";
import { KitWordsProvider } from "@/components/kit/words";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOut } from "@/lib/auth-client";
import { portalKitWords, portalLabel } from "@/domains/language/portal-copy";
import type { CustomerLanguage } from "@/domains/language/copy";
import { CustomerLanguageProvider } from "@/domains/language/client-portal";
import {
  saveCustomerLanguage,
  type LanguageActionResult,
} from "@/app/account/settings/language-actions";

type AccountLink = {
  href: string;
  label: Parameters<typeof portalLabel>[1];
  icon: IconName;
};

// PORTAL-1 section 4: one label set for phone and desktop, in the portal
// dictionary's words (Home, Rentals, Repairs, Bills, Account).
const ACCOUNT_LINKS: AccountLink[] = [
  { href: "/account", label: "Home", icon: "home" },
  { href: "/account/rentals", label: "Rentals", icon: "equipment" },
  { href: "/account/maintenance", label: "Repairs", icon: "repair" },
  { href: "/account/billing", label: "Bills", icon: "bill" },
  { href: "/account/settings", label: "Account", icon: "account" },
];

function activeFor(pathname: string, href: string) {
  if (href === "/account") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Compact header language switch; saves through the same action as the
 * Account page's language form, then refreshes so the new preference
 * renders (display stays subject to the IN-83 reviewed-copy rule). */
function LanguageSwitch({ language }: { language: CustomerLanguage }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [, action, pending] = useActionState<LanguageActionResult, FormData>(
    async (_previous, form: FormData) => {
      const result = await saveCustomerLanguage(form);
      router.refresh();
      return result;
    },
    { status: "idle", message: "" },
  );
  return (
    <form action={action} ref={formRef} className="print:hidden">
      <label className="sr-only" htmlFor="shell-language">
        Language / Idioma
      </label>
      <select
        id="shell-language"
        name="language"
        defaultValue={language}
        disabled={pending}
        onChange={() => formRef.current?.requestSubmit()}
        className="min-h-11 rounded-control border border-line-strong bg-surface px-2 py-2 text-sm font-semibold text-ink"
      >
        <option value="en">English</option>
        <option value="es">Español</option>
      </select>
    </form>
  );
}

export function AccountShell({
  children,
  language = "en",
  contact,
}: {
  children: ReactNode;
  language?: CustomerLanguage;
  /** The business phone and email, shown at the bottom of every page so help is always one tap away. */
  contact?: { phone: string | null; email: string | null };
}) {
  const pathname = usePathname();
  const t = (text: Parameters<typeof portalLabel>[1]) => portalLabel(language, text);
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      const result = await signOut();
      if (result.error) throw new Error("Sign out failed");
      router.push(language === "es" ? "/login?language=es" : "/login");
      router.refresh();
    } catch {
      setSignOutError(t("Couldn't sign out. Please try again."));
      setSigningOut(false);
    }
  }

  return (
    <CustomerLanguageProvider language={language}>
      <KitWordsProvider words={portalKitWords(language)}>
        <div className="min-h-screen bg-canvas" lang={language}>
          <header className="border-b border-line bg-surface print:hidden">
            <div className="mx-auto flex min-h-16 max-w-screen-2xl items-center gap-3 px-4 sm:px-6">
              <Link href="/account" className="flex min-h-11 items-center gap-3">
                <Image
                  src="/brand/badge.svg"
                  alt=""
                  width={32}
                  height={32}
                  className="h-8 w-8"
                />
                <span className="font-semibold text-ink">{t("My Account")}</span>
              </Link>

              <nav
                aria-label={t("My account")}
                className="ml-auto hidden items-center gap-1 lg:flex"
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
                      {t(link.label)}
                    </Link>
                  );
                })}
              </nav>

              <div className="ml-auto flex items-center gap-2 lg:ml-2">
                {contact?.phone ? (
                  <a
                    href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}
                    className="hidden min-h-11 items-center px-2 text-sm font-semibold text-ink underline lg:inline-flex"
                  >
                    {contact.phone}
                  </a>
                ) : null}
                <span className="hidden lg:block">
                  <LanguageSwitch language={language} />
                </span>
                <ThemeToggle />
                <button
                  type="button"
                  disabled={signingOut}
                  onClick={handleSignOut}
                  className="inline-flex min-h-11 items-center rounded-control px-3 py-2 text-sm font-semibold text-ink hover:bg-subtle disabled:opacity-50"
                >
                  {t(signingOut ? "Signing out…" : "Sign out")}
                </button>
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
            className="mx-auto min-w-0 max-w-screen-2xl p-4 pb-28 sm:p-6 lg:pb-8"
          >
            {children}
            <footer className="mt-10 border-t border-line pt-4 text-sm text-ink-soft print:hidden">
              {/* MCP-10a: problems with this website or app (not appliance repairs, which have their own page). English
                  only for now: Spanish wording waits for a translator's review. */}
              <Link
                className="font-semibold underline"
                lang="en"
                href={`/account/feedback/new?from=${encodeURIComponent(pathname)}`}
              >
                App feedback
              </Link>
              {contact?.phone ? (
                <>
                  {" · "}
                  {t("Call us")}{" "}
                  <a
                    className="font-semibold underline"
                    href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}
                  >
                    {contact.phone}
                  </a>
                </>
              ) : null}
              {contact?.email ? (
                <>
                  {" · "}
                  <a className="font-semibold underline" href={`mailto:${contact.email}`}>
                    {contact.email}
                  </a>
                </>
              ) : null}
            </footer>
          </main>

          <nav
            aria-label={t("My account")}
            className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] print:hidden lg:hidden"
          >
            <ul className="grid h-14 grid-cols-5">
              {ACCOUNT_LINKS.map((link) => {
                const active = activeFor(pathname, link.href);
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${
                        active ? "text-primary" : "text-ink-soft"
                      }`}
                    >
                      <Icon name={link.icon} size={24} />
                      {t(link.label)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <Toaster />
        </div>
      </KitWordsProvider>
    </CustomerLanguageProvider>
  );
}
