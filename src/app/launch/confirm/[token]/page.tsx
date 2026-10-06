import Link from "next/link";
import { headers } from "next/headers";
import { confirmLaunchSubscription } from "@/domains/launch";
import { isRateLimited } from "@/lib/rate-limit";

const CONFIRM_RATE_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 };

export default async function LaunchConfirmPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown";
  const limited = await isRateLimited(`launch-confirm:${ip}`, CONFIRM_RATE_LIMIT);
  const confirmed = limited ? false : await confirmLaunchSubscription(token);

  return (
    <main className="min-h-screen bg-canvas px-6 py-16 text-ink">
      <div className="mx-auto max-w-xl rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-ink-faint">
          Robinson Appliance Rentals
        </p>
        <h1 className="mt-3 text-3xl font-semibold">
          {confirmed ? "Email confirmed" : "Confirmation link unavailable"}
        </h1>
        <p className="mt-4 text-base leading-7 text-ink-soft">
          {confirmed
            ? "Thanks. This email address is confirmed for our launch updates. You can unsubscribe from any launch email at any time."
            : "This confirmation link is invalid, expired, or has already been used. No marketing emails will start from this link."}
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex rounded-lg bg-action px-4 py-2 font-medium text-on-action"
        >
          Return home
        </Link>
      </div>
    </main>
  );
}
