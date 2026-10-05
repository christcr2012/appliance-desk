import { requireRole } from "@/lib/session";
import { PageHeader } from "@/components/desk/workspace";
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
        description="Messages a customer is owed, such as the reminder before an automatic renewal. Each one is saved exactly as written."
      />
      <div className="mb-6 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-800">
        <p className="font-medium text-gray-900">How this works</p>
        <p className="mt-1">
          Colorado asks that a customer is reminded 25 to 40 days before an automatic renewal. The reminder is written
          for you the moment the renewal is set up, using the renewal wording the customer agreed to. It is emailed
          automatically, inside those days only, once live customer email is on (that switch is yours to approve; it is off
          today). If its last day passes it is never sent late. Until it has been delivered, the customer&rsquo;s renewal
          will not start.
        </p>
        <p className="mt-2">
          If you deliver it yourself, record how (mail, your business mailbox, a printed copy, or a text the customer agreed
          to). A phone call is not a delivery: the law lists mail, email, or another easily accessible form the customer
          authorized.
        </p>
      </div>
      {waiting.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-700">
          No notices are waiting to go out.
        </div>
      ) : (
        <ul className="space-y-4">
          {waiting.map((n) => (
            <NoticeCard
              key={n.id}
              noticeId={n.id}
              status={n.status}
              customerName={n.customer.user.name ?? n.customer.user.email}
              customerEmail={n.customer.user.email}
              createdLabel={formatBusinessDate(n.createdAt)}
              subject={n.subject}
              body={n.body}
              deadline={n.deadline}
              firstDayLabel={n.earliestAt ? formatBusinessDate(n.earliestAt) : null}
              lastDayLabel={n.deadlineAt ? formatBusinessDate(n.deadlineAt) : null}
              lastError={n.lastError}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
