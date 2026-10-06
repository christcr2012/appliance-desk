import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getLaunchSettings, launchEmailBlockReason } from "@/domains/launch";
import { LAUNCH_STEPS } from "@/domains/launch/messages";
import {
  Button,
  ButtonLink,
  Card,
  DataList,
  EmptyState,
  PageHeader,
  StatCard,
  StatusPill,
  type DataListColumn,
} from "@/components/ui";
import { Pagination } from "@/components/pagination";
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
  const [settings, total, active, unconfirmed, blocked, rows, sources] =
    await Promise.all([
      getLaunchSettings(),
      prisma.launchSubscriber.count(),
      prisma.launchSubscriber.count({
        where: { unsubscribedAt: null },
      }),
      prisma.launchSubscriber.count({
        where: { unsubscribedAt: null, confirmedAt: null },
      }),
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
          confirmedAt: true,
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
  type SubscriberRow = (typeof rows)[number];

  const subscriberColumns: DataListColumn<SubscriberRow>[] = [
    {
      key: "person",
      header: "Person",
      primary: true,
      cell: (subscriber) => (
        <div>
          <p className="font-semibold text-ink">{subscriber.name}</p>
          <p className="mt-1 text-sm font-normal text-ink-soft">
            {subscriber.email}
          </p>
          <p className="mt-1 text-xs font-normal text-ink-faint">
            {subscriber.createdAt.toLocaleDateString("en-US", {
              timeZone: "America/Denver",
            })}
          </p>
        </div>
      ),
    },
    {
      key: "needs",
      header: "Local needs",
      cell: (subscriber) => (
        <span>
          {subscriber.city}
          <br />
          {subscriber.interest}
        </span>
      ),
    },
    {
      key: "source",
      header: "Source",
      cell: (subscriber) => subscriber.source,
    },
    {
      key: "email",
      header: "Email status",
      cell: (subscriber) => {
        const status = subscriber.unsubscribedAt
          ? "Unsubscribed"
          : !subscriber.confirmedAt
            ? "Awaiting email confirmation"
            : subscriber.deliveryBlocked
              ? `Needs review / sending (${
                  subscriber.deliveries[0]?.status || "claimed"
                })`
              : subscriber.nextStep === 3
                ? "Welcome sequence complete"
                : `Waiting for email ${subscriber.nextStep + 1} of 3`;
        const tone = subscriber.unsubscribedAt
          ? "stopped"
          : !subscriber.confirmedAt
            ? "pending"
            : subscriber.deliveryBlocked
              ? "attention"
              : subscriber.nextStep === 3
                ? "success"
                : "progress";

        return <StatusPill tone={tone} label={status} />;
      },
    },
    {
      key: "action",
      header: "Action",
      cell: (subscriber) =>
        !subscriber.unsubscribedAt ? (
          <form action={suppressLaunchSubscriber}>
            <input type="hidden" name="id" value={subscriber.id} />
            <Button
              type="submit"
              variant="secondary"
              aria-label={`Stop marketing emails to ${subscriber.name}`}
            >
              Stop emails
            </Button>
          </form>
        ) : (
          "—"
        ),
    },
  ];

  const totalPages = Math.max(1, Math.ceil(total / 50));

  return (
    <div>
      <PageHeader
        title="Launch interest list"
        description="Local interest in the upcoming launch. These are opt-in subscribers, not booked rentals or quote requests."
        secondaryActions={
          <>
            <ButtonLink
              href="/launch?utm_source=instagram"
              variant="secondary"
            >
              Instagram signup link
            </ButtonLink>
            <ButtonLink
              href="/launch?utm_source=facebook"
              variant="secondary"
            >
              Facebook signup link
            </ButtonLink>
          </>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total signups" value={String(total)} />
        <StatCard label="Active" value={String(active)} />
        <StatCard
          label="Awaiting confirmation"
          value={String(unconfirmed)}
        />
        <StatCard
          label="Unsubscribed"
          value={String(total - active)}
        />
        <StatCard
          label="Need email review"
          value={String(blocked)}
        />
      </div>

      <div className="space-y-6">
        <Card
          title="Automation status"
          description={
            reason ||
            "Enabled on production. Daily run at 16:00 UTC (10 a.m. Mountain daylight time / 9 a.m. standard time)."
          }
        >
          {blocked > 0 && (
            <p className="mb-4 text-sm text-ink-soft">
              If an email remains marked for review after the daily run, check
              Resend&apos;s sending activity. Failed or uncertain sends stop
              that subscriber&apos;s sequence so they are not accidentally
              sent twice. Do not resend without checking the provider record.
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
        </Card>

        <Card
          title="Where signups came from"
          description="Source labels come from the signup link. They are self-reported attribution, not verified advertising conversions."
        >
          {sources.length ? (
            <ul className="space-y-2 text-sm text-ink">
              {sources.map((source) => (
                <li
                  key={source.source}
                  className="flex items-center justify-between gap-4 border-b border-line py-2 last:border-b-0"
                >
                  <span>{source.source}</span>
                  <span className="font-semibold">
                    {source._count._all}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No signups yet" />
          )}
        </Card>

        <Card title="Subscribers">
          <DataList
            rows={rows}
            columns={subscriberColumns}
            caption={`Launch subscribers, page ${page}`}
            empty={
              <EmptyState
                title="No subscribers on this page"
                description="New opt-in subscribers will appear here."
              />
            }
          />
          {totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              totalCount={total}
              buildHref={(nextPage) =>
                nextPage === 1
                  ? "/desk/launch"
                  : `/desk/launch?page=${nextPage}`
              }
            />
          )}
        </Card>

        <Card
          title="The automated welcome sequence"
          description="Provider acceptance is recorded; inbox delivery and opens are not tracked here. Launch announcements require a separate, reviewed send once the opening date is confirmed."
        >
          <ol className="space-y-4">
            {LAUNCH_STEPS.map((step, index) => (
              <li
                key={step.subject}
                className="rounded-card border border-line bg-subtle p-4"
              >
                <h3 className="font-semibold text-ink">
                  {index + 1}. {step.subject}
                </h3>
                <p className="mt-2 whitespace-pre-line text-sm text-ink-soft">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
