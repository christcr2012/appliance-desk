import { AuthBrand } from "@/components/auth-brand";
import { getJoinView } from "@/domains/team";
import { JoinForm } from "./join-form";

export const metadata = { title: "Join the team", robots: { index: false, follow: false } };
// The link code is a secret: never cache this page and never send the code anywhere else.
export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const view = await getJoinView(code);
  return (
    <main id="main-content" className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-12">
      <AuthBrand />
      <h1 className="mb-6 text-2xl font-semibold text-ink">Join the team</h1>
      {view.ok ? (
        <JoinForm code={code} name={view.name} email={view.email} accessLevel={view.accessLevel} />
      ) : (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{view.message}</div>
      )}
    </main>
  );
}
