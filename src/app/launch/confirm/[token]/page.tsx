import type { Metadata } from "next";
import Link from "next/link";
import { getBusinessSettings } from "@/domains/settings";
import { confirmLaunchAction } from "./actions";

export const metadata: Metadata = {
  title: "Confirm your email",
  robots: { index: false, follow: false },
};

export default async function LaunchConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ result?: string }>;
}) {
  const { token } = await params;
  const { result } = await searchParams;
  const settings = await getBusinessSettings();
  const businessName = settings.publicBusinessName || "Robinson Appliance Rentals";
  const state = result === "ok" ? "ok" : result === "failed" ? "failed" : "ask";

  return (
    <main className="min-h-screen bg-canvas px-6 py-16 text-ink">
      <div className="mx-auto max-w-xl rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-ink-faint">
          {businessName}
        </p>
        <h1 className="mt-3 text-3xl font-semibold">
          {state === "ok"
            ? "Email confirmed"
            : state === "failed"
              ? "This link can't be used"
              : "Confirm your email"}
        </h1>
        <p className="mt-4 text-base leading-7 text-ink-soft">
          {state === "ok"
            ? "Thanks. This email address is confirmed for our launch updates. You can unsubscribe from any launch email at any time."
            : state === "failed"
              ? "This confirmation link is invalid, expired, or has already been used. No marketing emails will start from this link. You can sign up again from the launch page."
              : "Press the button to get launch updates by email. Nothing is sent until you confirm."}
        </p>
        {state === "ask" ? (
          <form action={confirmLaunchAction} className="mt-8">
            <input type="hidden" name="token" value={token} />
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-lg bg-action px-5 font-medium text-on-action"
            >
              Yes, confirm my email
            </button>
          </form>
        ) : (
          <Link
            href={state === "failed" ? "/launch" : "/"}
            className="mt-8 inline-flex min-h-11 items-center rounded-lg bg-action px-5 font-medium text-on-action"
          >
            {state === "failed" ? "Sign up again" : "Return home"}
          </Link>
        )}
      </div>
    </main>
  );
}
