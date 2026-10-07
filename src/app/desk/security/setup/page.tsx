import { prisma } from "@/lib/prisma";
import { requireRoleForTwoFactorSetup } from "@/lib/session";
import { PageHeader, Card } from "@/components/ui";
import { TwoFactorSetupForm } from "./two-factor-setup-form";

export const metadata = {
  title: "Set up two-step login",
  robots: { index: false, follow: false },
};

export default async function TwoFactorSetupPage() {
  const session = await requireRoleForTwoFactorSetup("OWNER", "ADMIN", "STAFF");
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { twoFactorEnabled: true },
  });

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Set up two-step login"
        description="Use an authenticator app so a stolen password alone cannot open the business desk."
      />
      <Card title="Authenticator app">
        {user?.twoFactorEnabled ? (
          <div className="space-y-3">
            <p className="text-sm text-success">Two-step login is already set up for this account.</p>
            <p className="text-sm text-ink-soft">
              Keep your backup codes somewhere safe and separate from your phone.
            </p>
          </div>
        ) : (
          <TwoFactorSetupForm />
        )}
      </Card>
    </div>
  );
}
