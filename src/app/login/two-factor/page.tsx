import { TwoFactorLoginForm } from "./two-factor-login-form";

export const metadata = {
  title: "Two-step login — Appliance Desk",
  robots: { index: false, follow: false },
};

export default function TwoFactorLoginPage() {
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-12"
    >
      <h1 className="mb-2 text-2xl font-semibold text-ink">Two-step login</h1>
      <p className="mb-6 text-sm text-ink-soft">
        Your password was accepted. Enter the code from your authenticator app, or use one backup code.
      </p>
      <TwoFactorLoginForm />
    </main>
  );
}
