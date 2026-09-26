import { LoginForm } from "./login-form";

export const metadata = {
  title: "Log in — Appliance Desk",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-12">
      <h1 className="mb-6 text-2xl font-semibold">Log in</h1>
      <LoginForm />
    </main>
  );
}
