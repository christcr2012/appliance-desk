import Link from "next/link";
import { getServerSession } from "@/lib/session";
import { getPortalData } from "@/domains/portal";
import { SmsPreferenceForm } from "./sms-preference-form";

export const metadata = { title: "Settings" };

export default async function AccountSettingsPage() {
  const session = await getServerSession();
  const customer = session ? await getPortalData(session.user.id) : null;

  if (!customer) {
    return <p className="text-gray-600">No rental account found.</p>;
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold">Settings</h1>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="font-medium text-gray-900">Text message notifications</h2>
        <p className="mt-1 text-sm text-gray-600">
          Off by default — you only get texts if you turn this on.
        </p>
        <div className="mt-4">
          <SmsPreferenceForm
            initialOptedIn={Boolean(customer.smsOptInAt)}
            initialPhone={customer.phone ?? ""}
          />
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="font-medium text-gray-900">Privacy requests</h2>
        <p className="mt-1 text-sm text-gray-600">
          Request a copy of your account information or ask us to delete personal information we are allowed to remove.
        </p>
        <Link href="/account/settings/privacy" className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-primary underline">
          Manage privacy requests
        </Link>
      </div>
    </div>
  );
}
