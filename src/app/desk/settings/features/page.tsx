import Link from "next/link";
import { requireRole } from "@/lib/session";
import { ScreenHeader, Switch } from "@/components/kit";
import { FEATURES, FEATURE_KEYS, getFeatureVisibility } from "@/domains/features";
import { setFeatureShownAction } from "./actions";
import { practiceAppUrl } from "@/domains/features/practice";

export const metadata = { title: "Features", robots: { index: false, follow: false } };

export default async function FeaturesSettingsPage() {
  const session = await requireRole("OWNER", "ADMIN");
  const { shown, automatic } = await getFeatureVisibility();
  const practice = practiceAppUrl(process.env);
  return (
    <main className="mx-auto max-w-3xl px-5 py-5 lg:px-7 lg:py-6">
      <ScreenHeader title="Features" back={{ href: "/desk/settings", label: "Back to Settings" }} />
      <p className="mb-4 text-sm text-ink-soft">Turn on more when your business needs it. Starting choice: extra features are hidden from menus until needed, but their pages still work. Only the owner can change these choices.</p>
      <ul className="divide-y divide-line rounded-card border border-line bg-surface px-4">
        {FEATURE_KEYS.map(key => {
          const feature = FEATURES[key];
          const autoReason = automatic.get(key);
          return (
            <li key={key} className="py-4">
              <p className="text-sm text-ink-soft">{feature.line}</p>
              {autoReason ? (
                <div className="flex min-h-11 items-center justify-between gap-3">
                  <span className="font-bold text-ink">{feature.label}</span>
                  <button type="button" role="switch" aria-label={feature.label} aria-checked="true" disabled
                    title={autoReason} className="min-h-11 rounded-field border border-line px-4 text-sm font-bold text-ink-soft">
                    On automatically
                  </button>
                </div>
              ) : session.user.role === "OWNER" ? (
                <Switch label={feature.label} checked={shown.has(key)} action={setFeatureShownAction}
                  fields={{ feature: key }} onText={feature.label + " is shown."} offText={feature.label + " is hidden from menus."} />
              ) : (
                <div className="flex min-h-11 items-center justify-between gap-3">
                  <span className="font-bold text-ink">{feature.label}</span>
                  <span className="text-sm text-ink-soft">{shown.has(key) ? "Shown" : "Hidden"} · Owner only</span>
                </div>
              )}
              {autoReason ? <p className="text-xs text-ink-soft">{autoReason}</p> : null}
              <p className="text-xs text-ink-soft">
                {shown.has(key) ? "Shown in menus where you have access." : "Hidden from menus; still available by direct address."}
              </p>
            </li>
          );
        })}
      </ul>
      {practice ? (
        <section className="mt-6 rounded-card border border-line bg-surface p-4">
          <h2 className="text-base font-bold text-ink">Practice safely</h2>
          <p className="mt-1 text-sm text-ink-soft">A copy of the app with made-up customers. Nothing you do there charges cards or sends messages.</p>
          <a href={practice} target="_blank" rel="noopener noreferrer"
            className="mt-3 inline-flex min-h-11 items-center rounded-field bg-primary px-4 font-bold text-on-primary">
            Practice safely (opens in a new tab)
          </a>
        </section>
      ) : null}
      <p className="mt-5 text-sm text-ink-soft">These switches only organize navigation. They never add access to private business information.</p>
      <Link href="/desk/settings" className="mt-4 inline-flex min-h-11 items-center underline">Back to Settings</Link>
    </main>
  );
}
