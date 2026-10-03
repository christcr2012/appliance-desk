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
          automatically once live customer email is on (that switch is yours to approve; it is off today). Until it has
          been delivered, the customer&rsquo;s renewal will not start. If you contact the customer another way, mark it
          as delivered below.
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
              customerName={n.customer.user.name ?? n.customer.user.email}
              customerEmail={n.customer.user.email}
              createdLabel={formatBusinessDate(n.createdAt)}
              subject={n.subject}
              body={n.body}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
