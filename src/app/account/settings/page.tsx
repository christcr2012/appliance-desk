import { portalLanguage } from "@/domains/language/portal";
import { portalLabel } from "@/domains/language/portal-copy";
import { getServerSession } from "@/lib/session";
import { getPortalData } from "@/domains/portal";
import {
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
} from "@/components/ui";
import { SmsPreferenceForm } from "./sms-preference-form";
import { LanguagePreferenceForm } from "./language-preference-form";
import { readCustomerLanguage } from "@/domains/language";

export const metadata = { title: "Settings" };

export default async function AccountSettingsPage() {
  const session = await getServerSession();
  const locale = session ? await portalLanguage(session.user.id) : "en";
  const t = (text: Parameters<typeof portalLabel>[1]) => portalLabel(locale, text);
  const customer = session ? await getPortalData(session.user.id) : null;

  if (!customer) {
    return (
      <div className="max-w-3xl">
        <PageHeader title={t("Account")} />
        <EmptyState
          title={t("No rental account found")}
          description={t("Contact the business if you expected to manage account settings here.")}
        />
      </div>
    );
  }

  const preferredLanguage = await readCustomerLanguage(session!.user.id);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={t("Account")}
        description={t("Manage communication preferences and privacy requests.")}
      />

      <div className="space-y-6">
        <Card title={t("Preferred language / Idioma preferido")} description={t("Choose a preferred language without changing your legal agreement or communication consent.")}>
          <LanguagePreferenceForm initialLanguage={preferredLanguage} />
        </Card>
        <Card
          title={t("Text message notifications")}
          description={t("Off by default — you only get texts if you turn this on.")}
        >
          <SmsPreferenceForm
            initialOptedIn={Boolean(customer.smsOptInAt)}
            initialPhone={customer.phone ?? ""}
          />
        </Card>

        <Card
          title={t("Privacy requests")}
          description={t("Request a copy of your account information or ask us to delete personal information we are allowed to remove.")}
          actions={
            <ButtonLink
              href="/account/settings/privacy"
              variant="secondary"
            >{t("Manage privacy requests")}</ButtonLink>
          }
        >
          <p className="text-sm text-ink-soft">
            Billing, tax, signed-agreement and audit evidence may need to be
            retained even when a deletion request is fulfilled.
          </p>
        </Card>
      </div>
    </div>
  );
}
