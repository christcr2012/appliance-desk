import type { Metadata } from "next";
import { getPublicEmergencyState } from "@/domains/vault/emergency";
import { EmergencyFlow } from "./emergency-flow";

export const metadata: Metadata = {
  title: "Emergency access",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * VAULT-2: the public emergency page. No account and no sign-in — the link
 * itself (whose hash is all the app stores) is the credential, and the page
 * shows only what the flow's state allows. It ships inert: with emergency
 * access switched off (the default), every link reads as inactive.
 */
export default async function EmergencyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const state = await getPublicEmergencyState(token);
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12">
      <h1 className="text-2xl font-bold text-ink">Emergency access</h1>
      <p className="mt-1 text-sm text-ink-soft">Robinson Appliance Rentals — for the owner&apos;s emergency contact only.</p>
      <div className="mt-6 rounded-card border border-line bg-surface p-5 text-sm leading-relaxed">
        <EmergencyFlow token={token} state={state} />
      </div>
    </main>
  );
}
