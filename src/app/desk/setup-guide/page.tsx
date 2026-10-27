import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getSetupGuideState } from "@/domains/setup/guide";
import { WALKTHROUGHS } from "@/domains/setup/walkthroughs";
import { Button, Card, PageHeader } from "@/components/ui";
import { dismissWalkthroughAction, restoreWalkthroughAction } from "./actions";

export const metadata = { title: "Set up your business" };
export const dynamic = "force-dynamic";

/** A small progress ring (spec §9): the share of steps done, as an SVG circle. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 26;
  const circumference = 2 * Math.PI * r;
  const share = total === 0 ? 0 : done / total;
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`${done} of ${total} steps done`}>
      <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-line" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        strokeWidth="6"
        strokeLinecap="round"
        className="stroke-action"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - share)}
        transform="rotate(-90 32 32)"
      />
      <text x="32" y="37" textAnchor="middle" className="fill-ink text-sm font-bold">
        {done}/{total}
      </text>
    </svg>
  );
}

export default async function SetupGuidePage() {
  await requireRole("OWNER");
  const state = await getSetupGuideState();
  const byKey = new Map(state.walkthroughs.map((w) => [w.key, w]));
  const suggested = WALKTHROUGHS.find((w) => w.key === state.suggestedKey) ?? null;
  const active = WALKTHROUGHS.filter((w) => !byKey.get(w.key)?.dismissed);
  const dismissed = WALKTHROUGHS.filter((w) => byKey.get(w.key)?.dismissed);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Set up your business"
        description="Guided walkthroughs for the accounts and papers the business needs — your LLC, tax numbers, bank, licenses, insurance and backups. Each step says exactly what to do, and where it produces a number or a file, you save it straight onto the business record. Steps the app can check, it checks itself."
      />

      {suggested ? (
        <Card
          title={`Start here: ${suggested.title}`}
          description={`${suggested.why} About ${suggested.estimatedMinutes} minutes.`}
          actions={<Link href={`/desk/setup-guide/${suggested.key}`}>Open the walkthrough</Link>}
        >
          <p>
            {state.finishedCount} of {state.totalWalkthroughs} walkthroughs finished.
          </p>
        </Card>
      ) : (
        <Card title="Everything is set up">
          <p>Every walkthrough is finished or marked “Not for me”. Anything that renews will remind you from Business records.</p>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {active.map((w) => {
          const status = byKey.get(w.key);
          const done = status?.doneSteps ?? 0;
          const total = status?.totalSteps ?? w.steps.length;
          return (
            <Card key={w.key} title={w.title} description={w.why}>
              <div className="flex items-center gap-4">
                <ProgressRing done={done} total={total} />
                <div>
                  <p>
                    {done} of {total} steps
                    {status?.complete ? " — finished" : ""}
                  </p>
                  <p>About {w.estimatedMinutes} minutes</p>
                  {w.neededBy ? <p>{w.neededBy.label}.</p> : null}
                  <p>
                    <Link href={`/desk/setup-guide/${w.key}`}>
                      {status?.complete ? "Look again" : done > 0 ? "Keep going" : "Start"}
                    </Link>
                  </p>
                  {!status?.complete ? (
                    <form action={dismissWalkthroughAction.bind(null, w.key)}>
                      <Button type="submit">Not for me</Button>
                    </form>
                  ) : null}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {dismissed.length > 0 ? (
        <Card title="Marked “Not for me”" description="These stay out of your way unless you bring one back.">
          <ul>
            {dismissed.map((w) => (
              <li key={w.key}>
                {w.title}{" "}
                <form action={restoreWalkthroughAction.bind(null, w.key)} className="inline">
                  <Button type="submit">Bring it back</Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
