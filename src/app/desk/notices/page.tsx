import { requireRole } from "@/lib/session";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { listWaitingNotices } from "@/domains/notices";
import { formatBusinessDate } from "@/lib/business-date";
import { NoticeCard } from "./notice-card";

export const metadata = { title: "Notices" };

export default async function NoticesPage() {
  await requireRole("OWNER", "ADMIN");
  const waiting = await listWaitingNotices();

  return (
    <div>
      <PageHeader
        title="Notices waiting to go out"
        description="Messages a customer is owed, such as the reminder before an automatic renewal. Each notice is saved exactly as written."
      />

      <div className="mb-6">
        <Card title="How this works">
          <div className="space-y-2 text-sm text-ink-soft">
            <p>
              Colorado asks that a customer is reminded 25 to 40 days before
              an automatic renewal. The reminder is written when the renewal is
              set up using the wording the customer agreed to. It is emailed
              automatically only inside those days and only after live customer
              email is explicitly approved; live customer email remains off
              today. If its last day passes, it is never sent late. Until it
              has been delivered, the customer&apos;s renewal will not start.
            </p>
            <p>
              If you deliver it yourself, record how: mail, your business
              mailbox, a printed copy, or a text the customer agreed to. A phone
              call is not a delivery; the allowed methods are written forms the
              customer can access.
            </p>
          </div>
        </Card>
      </div>

      {waiting.length === 0 ? (
        <EmptyState
          title="No notices are waiting to go out"
          description="Renewal notices will appear here when a customer is owed one."
        />
      ) : (
        <ul className="space-y-4">
          {waiting.map((notice) => (
            <NoticeCard
              key={notice.id}
              noticeId={notice.id}
              status={notice.status}
              customerName={
                notice.customer.user.name ?? notice.customer.user.email
              }
              customerEmail={notice.customer.user.email}
              createdLabel={formatBusinessDate(notice.createdAt)}
              subject={notice.subject}
              body={notice.body}
              deadline={notice.deadline}
              firstDayLabel={
                notice.earliestAt
                  ? formatBusinessDate(notice.earliestAt)
                  : null
              }
              lastDayLabel={
                notice.deadlineAt
                  ? formatBusinessDate(notice.deadlineAt)
                  : null
              }
              lastError={notice.lastError}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
