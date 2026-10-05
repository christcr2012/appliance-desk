import Link from "next/link";
import { requireSession } from "@/lib/session";
import { listPrivacyRequestsForCustomer } from "@/domains/privacy";
import { accountPrivacyRequestAction } from "./actions";

export const metadata = { title: "Privacy requests" };

export default async function AccountPrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ requested?: string; error?: string }>;
}) {
  const session = await requireSession();
  const requests = await listPrivacyRequestsForCustomer(session.user.id);
  const params = await searchParams;

  return (
    <div className="max-w-2xl">
      <Link href="/account/settings" className="text-sm text-ink-soft hover:underline">
        &larr; Back to settings
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-ink">Privacy requests</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Request a copy of the personal information connected to your account or ask us to delete personal information
        we are allowed to remove. Billing, tax, signed-agreement and audit evidence may need to be retained.
      </p>

      {params.requested === "1" && (
        <p role="status" className="mt-4 rounded-lg border border-line bg-subtle p-3 text-sm text-ink">
          Your request was recorded and your signed-in session verified your identity. The owner will process it.
        </p>
      )}
      {params.error === "1" && (
        <p role="alert" className="mt-4 text-sm text-red-700">That request could not be recorded.</p>
      )}

      <form action={accountPrivacyRequestAction} className="mt-6 flex flex-wrap gap-3">
        <button type="submit" name="kind" value="EXPORT" className="min-h-11 rounded-lg border border-control px-4 py-2 text-sm font-medium text-primary hover:bg-subtle">
          Request my data
        </button>
        <button type="submit" name="kind" value="DELETE" className="min-h-11 rounded-lg border border-control px-4 py-2 text-sm font-medium text-primary hover:bg-subtle">
          Request deletion
        </button>
      </form>

      <section className="mt-8">
        <h2 className="font-medium text-ink">Your requests</h2>
        {requests.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">No privacy requests yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
            {requests.map((request) => (
              <li key={request.id} className="px-4 py-3 text-sm">
                <p className="font-medium text-ink">{request.kind === "EXPORT" ? "Data export" : "Deletion"}</p>
                <p className="text-ink-soft">
                  {request.status.toLowerCase().replaceAll("_", " ")} · {request.createdAt.toLocaleDateString("en-US")}
                </p>
                {request.rejectedReason && <p className="mt-1 text-ink-soft">Reason: {request.rejectedReason}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
