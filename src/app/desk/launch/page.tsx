import Link from "next/link";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getLaunchSettings, launchEmailBlockReason } from "@/domains/launch";
import { LAUNCH_STEPS } from "@/domains/launch/messages";
import { LaunchSettingsForm } from "./settings-form";
import { suppressLaunchSubscriber } from "./actions";

export const metadata = { title: "Launch interest list" };

export default async function LaunchDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const params = await searchParams;
  const page = Math.max(
    1,
    Math.min(100000, Number.parseInt(params.page || "1", 10) || 1),
  );
  const [settings, total, active, blocked, rows, sources] = await Promise.all([
    getLaunchSettings(),
    prisma.launchSubscriber.count(),
    prisma.launchSubscriber.count({ where: { unsubscribedAt: null } }),
    prisma.launchSubscriber.count({
      where: { unsubscribedAt: null, deliveryBlocked: true },
    }),
    prisma.launchSubscriber.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * 50,
      take: 50,
      select: {
        id: true,
        name: true,
        email: true,
        city: true,
        interest: true,
        source: true,
        createdAt: true,
        nextStep: true,
        unsubscribedAt: true,
        deliveryBlocked: true,
        deliveries: {
          select: { status: true, step: true },
          orderBy: { step: "desc" },
          take: 1,
        },
      },
    }),
    prisma.launchSubscriber.groupBy({
      by: ["source"],
      _count: { _all: true },
      orderBy: { _count: { source: "desc" } },
    }),
  ]);
  const reason = launchEmailBlockReason(settings);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Launch interest list</h1>
        <p className="mt-2 text-ink-soft">
          Local interest in the upcoming launch. These are opt-in subscribers,
          not booked rentals or quote requests.
        </p>
        <p className="mt-3">
          <Link href="/launch?utm_source=instagram" className="underline">
            Instagram signup link
          </Link>
          {" · "}
          <Link href="/launch?utm_source=facebook" className="underline">
            Facebook signup link
          </Link>
        </p>
      </div>
      <section
        aria-labelledby="launch-status"
        className="rounded-lg border border-line bg-white p-5"
      >
        <h2 id="launch-status" className="text-lg font-semibold">
          Automation status
        </h2>
        <p className="mt-2">
          {reason ||
            "Enabled on production. Daily run at 16:00 UTC (10 a.m. Mountain daylight time / 9 a.m. standard time)."}
        </p>
        <p className="mt-3">
          {total} signups · {active} subscribed · {total - active} unsubscribed
          · {blocked} emails needing review or currently sending
        </p>
        {blocked > 0 && (
          <p className="mt-2 text-sm text-ink-soft">
            If an email remains marked for review after the daily run, check
            Resend&apos;s sending activity. Failed or uncertain sends stop that
            subscriber&apos;s sequence so they are not accidentally sent twice.
            Do not resend without checking the provider record.
          </p>
        )}
        <LaunchSettingsForm
          settings={{
            prelaunchMode: settings.prelaunchMode,
            emailEnabled: settings.emailEnabled,
            postalAddress: settings.postalAddress,
            replyToEmail: settings.replyToEmail,
          }}
        />
      </section>
      <section>
        <h2 className="text-lg font-semibold">Where signups came from</h2>
        <ul className="mt-3 space-y-1">
          {sources.length ? (
            sources.map((s) => (
              <li key={s.source}>
                {s.source}: {s._count._all}
              </li>
            ))
          ) : (
            <li>No signups yet.</li>
          )}
        </ul>
        <p className="mt-2 text-sm text-ink-soft">
          Source labels come from the signup link. They are self-reported
          attribution, not verified advertising conversions.
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">Subscribers</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Launch subscribers, page {page}
            </caption>
            <thead>
              <tr>
                {[
                  "Person",
                  "Local needs",
                  "Source",
                  "Email status",
                  "Action",
                ].map((h) => (
                  <th key={h} scope="col" className="border-b p-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="border-b p-3">
                    <p className="font-medium">{s.name}</p>
                    <p>{s.email}</p>
                    <p>
                      {s.createdAt.toLocaleDateString("en-US", {
                        timeZone: "America/Denver",
                      })}
                    </p>
                  </td>
                  <td className="border-b p-3">
                    {s.city}
                    <br />
                    {s.interest}
                  </td>
                  <td className="border-b p-3">{s.source}</td>
                  <td className="border-b p-3">
                    {s.unsubscribedAt
                      ? "Unsubscribed"
                      : s.deliveryBlocked
                        ? `Needs review / sending (${s.deliveries[0]?.status || "claimed"})`
                        : s.nextStep === 3
                          ? "Welcome sequence complete"
                          : `Waiting for email ${s.nextStep + 1} of 3`}
                  </td>
                  <td className="border-b p-3">
                    {!s.unsubscribedAt && (
                      <form action={suppressLaunchSubscriber}>
                        <input type="hidden" name="id" value={s.id} />
                        <button
                          className="underline"
                          aria-label={`Stop marketing emails to ${s.name}`}
                        >
                          Stop emails
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <p className="mt-3">No subscribers on this page.</p>}
        <nav aria-label="Subscriber pages" className="mt-4 flex gap-5">
          {page > 1 && (
            <Link href={`/desk/launch?page=${page - 1}`} className="underline">
              Previous
            </Link>
          )}
          {page * 50 < total && (
            <Link href={`/desk/launch?page=${page + 1}`} className="underline">
              Next
            </Link>
          )}
        </nav>
      </section>
      <section>
        <h2 className="text-lg font-semibold">
          The automated welcome sequence
        </h2>
        <p className="mt-2 text-sm text-ink-soft">
          Provider acceptance is recorded; inbox delivery and opens are not
          tracked here. Launch announcements require a separate, reviewed send
          once the opening date is confirmed.
        </p>
        <ol className="mt-4 space-y-5">
          {LAUNCH_STEPS.map((s, i) => (
            <li
              key={s.subject}
              className="rounded-lg border border-line bg-white p-4"
            >
              <h3 className="font-semibold">
                {i + 1}. {s.subject}
              </h3>
              <p className="mt-2 whitespace-pre-line text-sm text-ink-soft">
                {s.body}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
