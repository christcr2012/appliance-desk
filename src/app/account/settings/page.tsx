import { ScreenHeader } from "@/components/kit/screen-header";
import { EmptyState } from "@/components/kit/empty-state";
import { InfoNote } from "@/components/portal/info-note";
import { portalLanguage } from "@/domains/language/portal";
import { portalLabel } from "@/domains/language/portal-copy";
import { getServerSession } from "@/lib/session";
import { getPortalData } from "@/domains/portal";
import { SmsPreferenceForm } from "./sms-preference-form";
import { LanguagePreferenceForm } from "./language-preference-form";
import { readCustomerLanguage } from "@/domains/language";
import Link from "next/link";

export const metadata = { title: "Account" };

/** PORTAL-1 section 5.6: three setting rows — Language / Idioma,
 * Text messages, Your information — with NO new data: each row hosts
 * the existing form or link. (The kit's SettingRow component is bound
 * to the desk's business-settings domain, so the rows use the kit row
 * styling around the portal's own forms.) The text-message row's
 * "off by default" sentence becomes its InfoNote. */
export default async function AccountSettingsPage() {
  const session = await getServerSession();
  const locale = session ? await portalLanguage(session.user.id) : "en";
  const t = (text: Parameters<typeof portalLabel>[1]) => portalLabel(locale, text);
  const customer = session ? await getPortalData(session.user.id) : null;

  if (!customer) {
    return (
      <div className="max-w-3xl">
        <h1 className="pb-4 text-xl font-bold text-ink">{t("Account")}</h1>
        <EmptyState title={t("No rental account found")} />
      </div>
    );
  }

  const preferredLanguage = await readCustomerLanguage(session!.user.id);
  const smsNote = t("Off by default — you only get texts if you turn this on.");

  return (
    <div className="max-w-3xl">
      <ScreenHeader title={t("Account")} />

      <div className="divide-y divide-line rounded-card border border-line bg-surface px-4">
        <section aria-label={t("Language / Idioma")} className="py-4">
          <h2 className="text-base font-bold text-ink">{t("Language / Idioma")}</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {t("Choose a preferred language without changing your legal agreement or communication consent.")}
          </p>
          <div className="mt-3">
            <LanguagePreferenceForm initialLanguage={preferredLanguage} />
          </div>
        </section>

        <section aria-label={t("Text messages")} className="py-4">
          <h2 className="flex items-center gap-1.5 text-base font-bold text-ink">
            {t("Text messages")}
            <InfoNote label={smsNote} text={smsNote} />
          </h2>
          <div className="mt-3">
            <SmsPreferenceForm
              initialOptedIn={Boolean(customer.smsOptInAt)}
              initialPhone={customer.phone ?? ""}
            />
          </div>
        </section>

        <section aria-label={t("Your information")} className="py-4">
          <Link href="/account/settings/privacy" className="group flex items-center justify-between gap-3">
            <span>
              <span className="block text-base font-bold text-ink group-hover:underline">{t("Your information")}</span>
              <span className="mt-1 block text-sm text-ink-soft">
                {t("Request a copy of your account information or ask us to delete personal information we are allowed to remove.")}
              </span>
            </span>
            <span aria-hidden="true" className="text-xl text-ink-soft">›</span>
          </Link>
        </section>
      </div>
    </div>
  );
}
