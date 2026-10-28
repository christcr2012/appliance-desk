import { headers } from "next/headers";
import { TwoFactorLoginForm } from "./two-factor-login-form";
import { auth } from "@/lib/auth";
import { getTrustedDeviceSettings } from "@/domains/security/trusted-devices";

// The remember-days setting is an owner setting that can change between deploys, so this page must read it
// on every request. Without this, Next.js prerenders the page at build time and the checkbox keeps the
// build-time value even after the owner turns remembering off.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Two-step login",
  robots: { index: false, follow: false },
};

export default async function TwoFactorLoginPage() {
  const { days } = await getTrustedDeviceSettings();
  // ACCT-1: an accountant is never offered "remember this device" (the verify
  // hook strips the request for the role as well — this only hides the box).
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  const rememberDays = session?.user?.role === "ACCOUNTANT" ? 0 : days;
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-12"
    >
      <h1 className="mb-2 text-2xl font-semibold text-ink">Two-step login</h1>
      <p className="mb-6 text-sm text-ink-soft">
        Your password was accepted. Enter the code from your authenticator app, or use one backup code.
      </p>
      <TwoFactorLoginForm rememberDays={rememberDays} />
    </main>
  );
}
