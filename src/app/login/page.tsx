import { authPageLanguage } from "@/domains/language/auth-page";
import { CustomerLanguageProvider } from "@/domains/language/client-portal";
import { portalLabel } from "@/domains/language/portal-copy";
import { Suspense } from "react";
import { AuthBrand } from "@/components/auth-brand";
import { LoginForm } from "./login-form";

export const metadata = {
  title: "Log in",
  robots: { index: false, follow: false },
};

export default async function LoginPage({searchParams}:{searchParams:Promise<{language?:string}>}) {
  const language=await authPageLanguage((await searchParams).language);
  const t=(text:Parameters<typeof portalLabel>[1])=>portalLabel(language,text);
  return (
    <CustomerLanguageProvider language={language}><main lang={language}
      id="main-content"
      className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-12"
    >
      <AuthBrand />
      <h1 className="mb-6 text-2xl font-semibold text-ink">{t("Log in")}</h1>
      {/* LoginForm reads the URL's search params (e.g. a redirect target),
          which Next.js requires to be inside a Suspense boundary so the
          rest of the page can still be served instantly. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main></CustomerLanguageProvider>
  );
}
