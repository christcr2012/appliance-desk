import { prisma } from "@/lib/prisma";
import { requireRoleForTwoFactorSetup } from "@/lib/session";
import { PageHeader, Card } from "@/components/ui";
import { getSecondStepView } from "@/domains/security/second-step";
import { TwoFactorSetupForm } from "./two-factor-setup-form";

export const metadata = {
  title: "Set up two-step login",
  robots: { index: false, follow: false },
};

export default async function TwoFactorSetupPage() {
  const session = await requireRoleForTwoFactorSetup("OWNER", "ADMIN", "STAFF", "ACCOUNTANT");
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { twoFactorEnabled: true },
  });

  const view = await getSecondStepView(session.user.id);
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Set up two-step login"
        description="Add a second step after your password so a stolen password alone cannot open the business desk."
      />
      <Card title="Second step">
        {user?.twoFactorEnabled ? (
          <div className="space-y-3">
            <p className="text-sm text-success">Two-step login is already set up for this account.</p>
            <p className="text-sm text-ink-soft">
              Keep your backup codes somewhere safe and separate from your phone.
            </p>
          </div>
        ) : (
          <TwoFactorSetupForm info={{ allowed: view.allowed, textCodesReady: view.textCodesReady, phone: view.phone, phoneConfirmed: view.phoneConfirmed }} />
        )}
      </Card>
    </div>
  );
}
