import { requireSession } from "@/lib/session";
import { listPrivacyRequestsForCustomer } from "@/domains/privacy";
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  StatusPill,
} from "@/components/ui";
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
    <div className="max-w-3xl">
      <PageHeader
        title="Privacy requests"
        description="Request a copy of the personal information connected to your account or ask us to delete personal information we are allowed to remove."
        secondaryActions={
          <ButtonLink href="/account/settings" variant="secondary">
            Back to Account
          </ButtonLink>
        }
      />

      <p className="mb-6 text-sm text-ink-soft">
        Billing, tax, signed-agreement and audit evidence may need to be
        retained.
      </p>

      {params.requested === "1" && (
        <p
          role="status"
          className="mb-6 rounded-card border border-line bg-subtle p-4 text-sm text-ink"
        >
          Your request was recorded and your signed-in session verified your
          identity. The owner will process it.
        </p>
      )}
      {params.error === "1" && (
        <p role="alert" className="mb-6 text-sm font-semibold text-danger">
          That request could not be recorded.
        </p>
      )}

      <div className="mb-6">
        <Card
          title="Make a privacy request"
          description="Choose the request you want the owner to review."
        >
          <form
            action={accountPrivacyRequestAction}
            className="flex flex-wrap gap-3"
          >
            <Button type="submit" name="kind" value="EXPORT">
              Request my data
            </Button>
            <Button
              type="submit"
              name="kind"
              value="DELETE"
              variant="danger"
            >
              Request deletion
            </Button>
          </form>
        </Card>
      </div>

      <Card title="Your requests">
        {requests.length === 0 ? (
          <EmptyState
            title="No privacy requests yet"
            description="Requests you submit will appear here with their current status."
          />
        ) : (
          <ul className="divide-y divide-line">
            {requests.map((request) => (
              <li key={request.id} className="py-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-ink">
                    {request.kind === "EXPORT" ? "Data export" : "Deletion"}
                  </p>
                  <StatusPill
                    tone={
                      request.status === "COMPLETED"
                        ? "success"
                        : request.status === "REJECTED"
                          ? "stopped"
                          : "pending"
                    }
                    label={request.status
                      .toLowerCase()
                      .replaceAll("_", " ")}
                  />
                </div>
                <p className="mt-2 text-ink-soft">
                  Submitted{" "}
                  {request.createdAt.toLocaleDateString("en-US")}
                </p>
                {request.rejectedReason && (
                  <p className="mt-1 text-ink-soft">
                    Reason: {request.rejectedReason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
