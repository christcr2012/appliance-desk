import Link from "next/link";
import { TurnOffAutoRenew } from "./turn-off-auto-renew";
import { EndRental } from "./end-rental";
import { getMonthToMonthEndQuote } from "@/domains/agreements/month-to-month";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { getServerSession } from "@/lib/session";
import { getPortalRentals, PORTAL_PAGE_SIZE } from "@/domains/portal";
import { effectiveMonthToMonthTerms } from "@/domains/agreements/month-to-month";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/domains/pricing/money";
import {
  rentalAgreementStatusLabel,
  jobStatusLabel,
  jobTypeLabel,
} from "@/lib/status-labels";

export const metadata = { title: "My rentals" };

export default async function AccountRentalsPage({
  searchParams,
}: {
  searchParams: Promise<{ jobs?: string }>;
}) {
  const { jobs: rawJobs } = await searchParams;
  const jobLimit = Math.min(Math.max(Number.parseInt(rawJobs ?? "", 10) || PORTAL_PAGE_SIZE, PORTAL_PAGE_SIZE), 200);
  const session = await getServerSession();
  const data = session ? await getPortalRentals(session.user.id, { jobLimit }) : null;

  if (!data) {
    return <p className="text-gray-600">No rental account found.</p>;
  }

  const endQuotes = new Map<string, Awaited<ReturnType<typeof getMonthToMonthEndQuote>>>();
  const m2mTerms = new Map<string, { noticeDays: number; termsText: string }>();
  for (const a of data.agreements) {
    if (a.status === "ACTIVE" && a.termMonths === null) {
      endQuotes.set(a.id, await getMonthToMonthEndQuote(a.id));
      const t = await prisma.$transaction((tx) => effectiveMonthToMonthTerms(tx, a.id, new Date()));
      if (t) m2mTerms.set(a.id, { noticeDays: t.noticeDays, termsText: t.termsText });
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold">My rentals</h1>

      {data.agreements.length === 0 ? (
        <p className="mt-4 text-sm text-gray-600">
          You don&apos;t have any rentals yet.
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          {data.agreements.map((a) => {
            const m2m = m2mTerms.get(a.id);
            const hasTerms = a.terms.ending || a.terms.autoRenew || m2m;
            return (
              <div
                key={a.id}
                className="rounded-lg border border-gray-200 bg-white p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="font-medium text-gray-900">
                    {a.serviceAddress.line1}, {a.serviceAddress.city}
                  </h2>
                  <span className="text-sm text-gray-500">
                    {rentalAgreementStatusLabel(a.status)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-600">
                  {a.termMonths
                    ? `${a.termMonths}-month term`
                    : "Month-to-month"}
                </p>
                {a.nextVisit && (
                  <p className="mt-1 text-sm text-gray-900">
                    Next visit: {jobTypeLabel(a.nextVisit.type)} on{" "}
                    {formatBusinessDate(a.nextVisit.scheduledAt)} · {formatBusinessTime(a.nextVisit.scheduledAt)}
                  </p>
                )}
                {a.renewalStartsOn && (
                  <p className="mt-1 text-sm text-gray-900">Renewal starts on {formatBusinessDate(a.renewalStartsOn)}.</p>
                )}
                {a.status === "ACTIVE" && a.terminationEffectiveOn && a.terminationRequestedAt && (
                  <p className="mt-1 text-sm text-gray-900">
                    Ends on {formatBusinessDate(a.terminationEffectiveOn)}.
                  </p>
                )}

                <ul className="mt-3 space-y-1 text-sm text-gray-700">
                  {a.lines.map((l) => (
                    <li key={l.id}>
                      {l.label} — {formatCents(l.monthlyPriceCents)}/month
                      {l.prepayDiscountCentsPerMonth > 0 && (
                        <span className="text-gray-500">
                          {" "}
                          (list price {formatCents(l.listPriceCents)}, includes
                          a {formatCents(l.prepayDiscountCentsPerMonth)}/month
                          term discount)
                        </span>
                      )}{" "}
                      ({l.appliances.join(", ")})
                    </li>
                  ))}
                </ul>

                <p className="mt-3 text-sm font-medium text-gray-900">
                  Total: {formatCents(a.monthlyTotalCents)}/month
                </p>
                {a.freeMonthGranted && (
                  <p className="text-sm font-medium text-green-700">
                    Paid in full, in advance — your first month was free.
                  </p>
                )}
                {hasTerms && (
                  <details className="mt-3 rounded-lg border border-gray-200 p-3 text-sm text-gray-900">
                    <summary className="cursor-pointer font-medium">The terms of this rental</summary>
                    {a.terms.ending && (
                      <div className="mt-2 space-y-1">
                        {a.terms.ending.lines.map((line) => (
                          <p key={line}>{line}</p>
                        ))}
                        <p className="whitespace-pre-line text-gray-600">{a.terms.ending.termsText}</p>
                      </div>
                    )}
                    {m2m && (
                      <div className="mt-2 space-y-1">
                        <p>Ending this rental: no fee, {m2m.noticeDays} days&apos; notice.</p>
                        <p className="whitespace-pre-line text-gray-600">{m2m.termsText}</p>
                      </div>
                    )}
                    {a.terms.autoRenew && (
                      <div className="mt-2 space-y-1">
                        <p>{a.terms.autoRenew.noticeLine}</p>
                        <p className="whitespace-pre-line text-gray-600">{a.terms.autoRenew.termsText}</p>
                      </div>
                    )}
                  </details>
                )}
                {a.status === "ACTIVE" && a.renewalPreference === "AUTO_RENEW" && (
                  <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="text-sm text-gray-900">
                      Your rental is set to renew automatically. If you would rather it ended, you can turn that off here at any time before the renewal date.
                    </p>
                    <TurnOffAutoRenew agreementId={a.id} />
                  </div>
                )}
                {a.status === "ACTIVE" && a.termMonths === null && a.terminationRequestedAt && a.terminationEffectiveOn && (
                  <p className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-900">
                    Your rental is set to end on {formatBusinessDate(a.terminationEffectiveOn)}. There is no fee. We will
                    contact you to arrange picking up the appliances.
                  </p>
                )}
                {(() => {
                  const q = endQuotes.get(a.id);
                  if (!q) return null;
                  return (
                    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <p className="text-sm text-gray-900">
                        You can end this rental at any time, with no fee. With {q.noticeDays} days&apos; notice it would end on{" "}
                        {formatBusinessDate(q.effectiveOn)}; your last monthly charge would cover the period through{" "}
                        {formatBusinessDate(q.lastBilledDay)}.
                      </p>
                      <EndRental
                        agreementId={a.id}
                        effectiveOn={q.effectiveOn.toISOString()}
                        lastBilledDay={q.lastBilledDay.toISOString()}
                        noticeDays={q.noticeDays}
                        termsVersion={q.termsVersion}
                        effectiveLabel={formatBusinessDate(q.effectiveOn)}
                        lastBilledLabel={formatBusinessDate(q.lastBilledDay)}
                      />
                    </div>
                  );
                })()}
                {a.depositCents > 0 && (
                  <p className="text-sm text-gray-600">
                    Deposit required: {formatCents(a.depositCents)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Link
        href="/account/maintenance?request=pickup"
        className="mt-6 inline-flex min-h-11 items-center rounded-lg border border-control px-4 py-2 text-primary hover:bg-subtle"
      >
        Request pickup
      </Link>
      <p className="mt-2 text-sm text-ink-soft">
        A pickup request is reviewed by the business; it does not cancel your
        agreement or change billing automatically.
      </p>
      <div className="mt-8">
        <h2 className="font-medium text-gray-900">
          Delivery &amp; visit history
        </h2>
        {data.jobs.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No visits scheduled yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {data.jobs.map((j) => (
              <li key={j.id} className="px-4 py-3 text-sm">
                <p className="font-medium text-gray-900">
                  {jobTypeLabel(j.type)}
                </p>
                <p className="text-gray-600">
                  {jobStatusLabel(j.status)}
                  {j.scheduledAt &&
                    ` · ${`${formatBusinessDate(j.scheduledAt)} · ${formatBusinessTime(j.scheduledAt)}`}`}
                </p>
              </li>
            ))}
          </ul>
        )}
        {data.hasMoreJobs && (
          <Link
            href={`/account/rentals?jobs=${jobLimit + PORTAL_PAGE_SIZE}`}
            className="mt-3 inline-flex min-h-11 items-center text-sm text-primary underline"
          >
            Show more visits
          </Link>
        )}
      </div>
    </div>
  );
}
