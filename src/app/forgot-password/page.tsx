import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = {
  title: "Forgot your password? — Appliance Desk",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-12"
    >
      <h1 className="mb-2 text-2xl font-semibold text-ink">
        Forgot your password?
      </h1>
      <p className="mb-6 text-sm text-gray-600">
        Enter the email you use to log in and we&apos;ll send you a link to
        set a new password.
      </p>
      <ForgotPasswordForm />
      <p className="mt-6 text-sm text-gray-600">
        <Link href="/login" className="text-primary hover:underline">
          Back to log in
        </Link>
      </p>
    </main>
  );
}
