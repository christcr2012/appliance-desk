import { requireRole } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { InfoTip, Switch, Toaster } from "@/components/kit";
import { getNotificationPreferences } from "@/domains/notifications";
import { KIND_META } from "@/domains/notifications/kind-meta";
import { setNotificationPreferenceAction } from "@/app/desk/notifications/actions";

export const metadata = { title: "Your notifications", robots: { index: false, follow: false } };

/**
 * AR-13: "Choose what you get" — one row per notification kind this person can receive (the same
 * recipient rules that decide sending), each with an in-app and an email switch. Starting values:
 * in the app on, email off. A person who can receive none of the kinds (staff today) is told so.
 */
export default async function NotificationPreferencesPage() {
  const session = await requireRole("OWNER", "ADMIN", "STAFF", "ACCOUNTANT");
  const preferences = await getNotificationPreferences(session.user.id);
  return (
    <div className="max-w-2xl space-y-5">
      <Toaster />
      <PageHeader title="Your notifications" />
      {preferences.length === 0 ? (
        <p className="rounded-card border border-line bg-surface p-4 text-sm text-ink">
          You don&apos;t get notifications yet.
        </p>
      ) : (
        <>
          <p className="text-sm text-ink-soft">
            These choices are only yours. Email is off to start so your inbox stays quiet; turn it
            on for the ones you never want to miss.
          </p>
          {preferences.map((preference) => {
            const meta = KIND_META[preference.kind];
            return (
              <section
                key={preference.kind}
                aria-label={meta.label}
                className="space-y-1 rounded-card border border-line bg-surface p-4"
              >
                <div className="flex items-center gap-2">
                  <h2 className="text-[15px] font-bold text-ink">{meta.label}</h2>
                  <InfoTip term={meta.glossary} />
                </div>
                <Switch
                  label="In the app"
                  checked={preference.inApp}
                  action={setNotificationPreferenceAction}
                  fields={{ kind: preference.kind, channel: "inApp" }}
                  onText={`${meta.label} will show in the app.`}
                  offText={`${meta.label} won't show in the app.`}
                />
                <Switch
                  label="By email"
                  checked={preference.email}
                  action={setNotificationPreferenceAction}
                  fields={{ kind: preference.kind, channel: "email" }}
                  onText={`${meta.label} will also be emailed to you.`}
                  offText={`${meta.label} won't be emailed to you.`}
                />
                <p className="pt-1 text-xs text-ink-soft">Texts: available when texting is turned on</p>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
