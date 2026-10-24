import { requireRole } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { getMyAccount } from "@/domains/account";
import { listOwnSessions } from "@/domains/security/sessions";
import { getSecondStepView } from "@/domains/security/second-step";
import { SecondStepCard } from "./second-step-card";
import { DevicesCard, EmailCard, PasswordCard, ProfileCard, TwoStepCard } from "./account-forms";

export const metadata = { title: "My account", robots: { index: false, follow: false } };

/** Everyone on the desk (owner, admin, staff) sees only their own account here. Nothing takes a person id from the address or a form. */
export default async function MyAccountPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const params = await searchParams;
  const [account, sessions, step] = await Promise.all([
    getMyAccount(session.user.id),
    listOwnSessions(session.user.id, session.session.token),
    getSecondStepView(session.user.id),
  ]);
  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader title="My account" description="Your own sign-in details. Changes here are recorded and you are emailed about them." />
      {params.email === "confirmed" && (
        <p role="status" className="rounded-control border border-line p-3 text-sm text-success">Your sign-in email was changed.</p>
      )}
      <ProfileCard name={account.name} phone={account.phone} phoneConfirmed={account.phoneConfirmed} />
      <PasswordCard />
      <EmailCard email={account.email} />
      <TwoStepCard enabled={account.twoFactorEnabled} required={account.twoFactorRequired} />
      <SecondStepCard method={step.method} enrolled={step.enrolled} allowed={step.allowed} notAllowedAnymore={step.methodNotAllowedAnymore} phone={step.phone} phoneConfirmed={step.phoneConfirmed} textCodesReady={step.textCodesReady} />
      <DevicesCard
        devices={sessions.map((row) => ({ id: row.id, device: row.device, lastActiveAt: row.lastActiveAt.toISOString(), current: row.current }))}
      />
    </div>
  );
}
