import { Suspense } from "react";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata = {
  title: "Set your password — Appliance Desk",
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-12"
    >
      <h1 className="mb-6 text-2xl font-semibold text-ink">
        Set your password
      </h1>
      {/* ResetPasswordForm reads the ?token= Better Auth put in the URL,
          which Next.js requires to be inside a Suspense boundary. */}
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
