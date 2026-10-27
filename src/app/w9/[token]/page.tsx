import { w9LinkState } from "@/domains/compliance/w9";
import { W9Forms } from "./w9-forms";

export const metadata = { title: "Send your W-9", robots: { index: false, follow: false } };

/**
 * CMP-3: the public one-time W-9 page. The link is the credential: it
 * works once, expires in 14 days, and shows nothing about the supplier
 * beyond their name.
 */
export default async function W9Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const state = await w9LinkState(token);
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-bold text-ink">Robinson Appliance Rentals — W-9 request</h1>
      {!state.ok ? (
        <div className="mt-6 rounded-card bg-surface p-5">
          <p className="text-sm text-ink-soft">
            {state.reason === "used"
              ? "This link has already been used — your W-9 is on file. If you need to change anything, ask us for a fresh link."
              : state.reason === "expired"
                ? "This link has expired. Ask us for a fresh one and we'll send it right over."
                : "This link doesn't look right. Check the address, or ask us for a fresh link."}
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <p className="text-sm text-ink-soft">
            Hello {state.supplierName} — federal tax rules require us to keep a W-9 on file for the people and
            businesses we pay. Pick whichever way is easier; the link works once.
          </p>
          <W9Forms token={token} />
        </div>
      )}
    </main>
  );
}
