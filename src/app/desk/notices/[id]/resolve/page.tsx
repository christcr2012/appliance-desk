import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { PageHeader } from "@/components/desk/workspace";
import { prisma } from "@/lib/prisma";
import { getMissedNoticeOptions } from "@/domains/notices/resolution";
import { ResolveForm } from "./resolve-form";

export const metadata = { title: "Fix a missed reminder" };

export default async function ResolveNoticePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const notice = await prisma.customerNotice.findUnique({
    where: { id },
    select: { id: true, subject: true, customer: { select: { user: { select: { name: true, email: true } } } } },
  });
  if (!notice) notFound();
  const result = await getMissedNoticeOptions(id);
  const name = notice.customer.user.name ?? notice.customer.user.email;
  const stillNeedsFixing = ["MISSED", "UNCERTAIN", "FAILED"].includes(result.notice.status);

  return (
    <div>
      <PageHeader title={`Fix a missed reminder: ${name}`} />
      <p className="-mt-2 mb-6 max-w-2xl text-sm leading-6 text-ink-soft">
        Every way forward, in one place. Nothing happens until you choose one and press the button.
      </p>
      {!stillNeedsFixing ? (
        <div className="rounded-lg border border-line bg-white p-6 text-sm text-ink-soft">
          This reminder no longer needs fixing (it is {result.notice.status.toLowerCase().replace("_", " ")}).
        </div>
      ) : (
        <ResolveForm
          noticeId={id}
          expectedUpdatedAt={result.notice.updatedAt.toISOString()}
          noticeStatus={result.notice.status}
          options={result.options}
        />
      )}
    </div>
  );
}
