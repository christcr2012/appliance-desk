import { requireRole } from "@/lib/session";
import { listPrivacyRequestsForOwner } from "@/domains/privacy";
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Field,
  PageHeader,
  StatusPill,
} from "@/components/ui";
import {
  fulfillPrivacyDeletionAction,
  rejectPrivacyRequestAction,
  verifyPrivacyByPhoneAction,
} from "./actions";

export const metadata = { title: "Privacy requests" };

function label(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function statusTone(
  status: string,
): "pending" | "progress" | "success" | "stopped" {
  if (status === "FULFILLED") return "success";
  if (status === "REJECTED") return "stopped";
  if (status === "VERIFIED") return "progress";
  return "pending";
}

export default async function DeskPrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string; error?: string }>;
}) {
  const session = await requireRole("OWNER");
  const [requests, params] = await Promise.all([
    listPrivacyRequestsForOwner(session.user.id),
    searchParams,
  ]);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Privacy requests"
        description="Verify identity before fulfilling a request. Deletion removes or pseudonymizes personal data but preserves invoices, payments, signed agreements, document evidence, notices and audit records that the business must keep."
      />

      {params.updated && (
        <p
          role="status"
          className="mb-4 rounded-control border border-line bg-subtle p-3 text-sm font-medium text-success"
        >
          Privacy request updated.
        </p>
      )}
      {params.error && (
        <p
          role="alert"
          className="mb-4 rounded-control border border-line bg-subtle p-3 text-sm font-medium text-danger"
        >
          That privacy action could not be completed.
        </p>
      )}

      {requests.length === 0 ? (
        <EmptyState
          title="No privacy requests"
          description="Customer privacy requests will appear here for owner review."
        />
      ) : (
        <div className="space-y-4">
          {requests.map((request) => (
            <Card
              key={request.id}
              title={request.kind === "EXPORT" ? "Data export" : "Deletion"}
              description={request.requesterEmail}
              actions={
                <StatusPill
                  tone={statusTone(request.status)}
                  label={label(request.status)}
                />
              }
            >
              <div className="space-y-3">
                <p className="text-xs text-ink-faint">
                  Request {request.id} ·{" "}
                  {request.createdAt.toLocaleString("en-US")}
                </p>

                {request.notes && (
                  <p className="text-sm text-ink-soft">{request.notes}</p>
                )}
                {request.rejectedReason && (
                  <p className="text-sm font-medium text-danger">
                    Rejected: {request.rejectedReason}
                  </p>
                )}

                {(request.status === "RECEIVED" ||
                  request.status === "VERIFIED") && (
                  <div className="space-y-4 border-t border-line pt-4">
                    {request.status === "RECEIVED" &&
                      request.customerId && (
                        <form action={verifyPrivacyByPhoneAction}>
                          <input
                            type="hidden"
                            name="requestId"
                            value={request.id}
                          />
                          <Button type="submit" variant="secondary">
                            I verified this person by phone
                          </Button>
                        </form>
                      )}

                    {request.status === "VERIFIED" &&
                      request.kind === "EXPORT" && (
                        <ButtonLink
                          href={`/api/privacy/export/${request.id}`}
                          variant="secondary"
                        >
                          Download customer data JSON
                        </ButtonLink>
                      )}

                    {request.status === "VERIFIED" &&
                      request.kind === "DELETE" && (
                        <form
                          action={fulfillPrivacyDeletionAction}
                          className="grid gap-3 sm:grid-cols-[minmax(12rem,1fr)_auto] sm:items-end"
                        >
                          <input
                            type="hidden"
                            name="requestId"
                            value={request.id}
                          />
                          <Field
                            name="confirmation"
                            label="Type DELETE to confirm"
                            required
                          />
                          <Button type="submit" variant="danger">
                            Pseudonymize personal data
                          </Button>
                        </form>
                      )}

                    <form
                      action={rejectPrivacyRequestAction}
                      className="grid gap-3 sm:grid-cols-[minmax(16rem,1fr)_auto] sm:items-end"
                    >
                      <input
                        type="hidden"
                        name="requestId"
                        value={request.id}
                      />
                      <Field
                        name="reason"
                        label="Rejection reason"
                        required
                        minLength={3}
                      />
                      <Button type="submit" variant="secondary">
                        Reject request
                      </Button>
                    </form>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
