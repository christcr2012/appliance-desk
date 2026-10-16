import { authPageLanguage } from "@/domains/language/auth-page";
import { CustomerLanguageProvider } from "@/domains/language/client-portal";
import { portalLabel } from "@/domains/language/portal-copy";
import { Suspense } from "react";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata = {
  title: "Set your password — Appliance Desk",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({searchParams}:{searchParams:Promise<{language?:string}>}) {
  const language=await authPageLanguage((await searchParams).language);
  const t=(text:Parameters<typeof portalLabel>[1])=>portalLabel(language,text);
  return (
    <CustomerLanguageProvider language={language}><main
      id="main-content"
      className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-12"
    >
      <h1 className="mb-6 text-2xl font-semibold text-ink">
        {t("Set your password")}
      </h1>
      {/* ResetPasswordForm reads the ?token= Better Auth put in the URL,
          which Next.js requires to be inside a Suspense boundary. */}
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </main></CustomerLanguageProvider>
  );
}
