import { authPageLanguage } from "@/domains/language/auth-page";
import { CustomerLanguageProvider } from "@/domains/language/client-portal";
import { portalLabel } from "@/domains/language/portal-copy";
import Link from "next/link";
import { AuthBrand } from "@/components/auth-brand";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = {
  title: "Forgot your password?",
  robots: { index: false, follow: false },
};

export default async function ForgotPasswordPage({searchParams}:{searchParams:Promise<{language?:string}>}) {
  const language=await authPageLanguage((await searchParams).language);
  const t=(text:Parameters<typeof portalLabel>[1])=>portalLabel(language,text);
  return (
    <CustomerLanguageProvider language={language}><main lang={language}
      id="main-content"
      className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-12"
    >
      <AuthBrand />
      <h1 className="mb-2 text-2xl font-semibold text-ink">
        {t("Forgot your password?")}
      </h1>
      <p className="mb-6 text-sm text-ink-soft">
        {t("Enter the email you use to log in and we'll send you a link to set a new password.")}
      </p>
      <ForgotPasswordForm />
      <p className="mt-6 text-sm text-ink-soft">
        <Link href={language==="es"?"/login?language=es":"/login"} className="text-primary hover:underline">
          {t("Back to log in")}
        </Link>
      </p>
    </main></CustomerLanguageProvider>
  );
}
