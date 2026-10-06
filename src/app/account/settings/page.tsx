import { getServerSession } from "@/lib/session";
import { getPortalData } from "@/domains/portal";
import {
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
} from "@/components/ui";
import { SmsPreferenceForm } from "./sms-preference-form";

export const metadata = { title: "Settings" };

export default async function AccountSettingsPage() {
  const session = await getServerSession();
  const customer = session ? await getPortalData(session.user.id) : null;

  if (!customer) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Account" />
        <EmptyState
          title="No rental account found"
          description="Contact the business if you expected to manage account settings here."
        />
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Account"
        description="Manage communication preferences and privacy requests."
      />

      <div className="space-y-6">
        <Card
          title="Text message notifications"
          description="Off by default — you only get texts if you turn this on."
        >
          <SmsPreferenceForm
            initialOptedIn={Boolean(customer.smsOptInAt)}
            initialPhone={customer.phone ?? ""}
          />
        </Card>

        <Card
          title="Privacy requests"
          description="Request a copy of your account information or ask us to delete personal information we are allowed to remove."
          actions={
            <ButtonLink
              href="/account/settings/privacy"
              variant="secondary"
            >
              Manage privacy requests
            </ButtonLink>
          }
        >
          <p className="text-sm text-ink-soft">
            Billing, tax, signed-agreement and audit evidence may need to be
            retained even when a deletion request is fulfilled.
          </p>
        </Card>
      </div>
    </div>
  );
}
