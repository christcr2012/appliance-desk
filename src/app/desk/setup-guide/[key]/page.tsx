import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { getSetupGuideState } from "@/domains/setup/guide";
import { describeCheck, getWalkthrough } from "@/domains/setup/walkthroughs";
import { PAPERWORK_TEMPLATES } from "@/domains/paperwork/templates";
import { Button, Card, PageHeader } from "@/components/ui";
import {
  dismissWalkthroughAction,
  markStepDoneAction,
  reopenStepAction,
} from "../actions";
import { StepSaveForms } from "./step-form";

export const dynamic = "force-dynamic";

export default async function WalkthroughPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  await requireRole("OWNER");
  const { key } = await params;
  const walkthrough = getWalkthrough(key);
  if (!walkthrough) notFound();
  const state = await getSetupGuideState();
  const status = state.walkthroughs.find((w) => w.key === key);
  const templateByKey = new Map(PAPERWORK_TEMPLATES.map((t) => [t.key, t]));

  return (
    <div className="space-y-6">
      <PageHeader
        title={walkthrough.title}
        description={walkthrough.why}
        primaryAction={<Link href="/desk/setup-guide">← All walkthroughs</Link>}
      />

      <Card title="Have ready" description={`About ${walkthrough.estimatedMinutes} minutes in total.`}>
        <ul>
          {walkthrough.needs.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        {walkthrough.neededBy ? <p>{walkthrough.neededBy.label}.</p> : null}
        {status?.dismissed ? (
          <p>You marked this walkthrough “Not for me”. It stays out of the suggestions until you bring it back from the Set up your business page.</p>
        ) : null}
      </Card>

      {walkthrough.steps.map((step, index) => {
        const stepStatus = status?.steps.find((s) => s.key === step.key);
        const template = step.record ? templateByKey.get(step.record.templateKey) : undefined;
        const showNumber = Boolean(step.record?.fields.includes("number"));
        const showFile = Boolean(step.record?.fields.includes("file"));
        return (
          <Card
            key={step.key}
            title={`${index + 1}. ${step.title}`}
            description={
              stepStatus?.done
                ? stepStatus.checked
                  ? "Checked ✓ — the app verified this one itself."
                  : "Done — you marked it."
                : undefined
            }
          >
            <p>{step.body}</p>
            {step.link ? (
              <p>
                <a href={step.link.href} target="_blank" rel="noreferrer">
                  {step.link.label} ↗
                </a>
              </p>
            ) : null}
            {step.check ? (
              <p>
                {stepStatus?.checked
                  ? `Checked ✓ — ${describeCheck(step.check)}.`
                  : `The app can check this itself: ${describeCheck(step.check)}.`}
              </p>
            ) : null}
            {step.record ? (
              <p>
                {stepStatus?.recordId ? (
                  <Link href={`/desk/paperwork/${stepStatus.recordId}`}>
                    Open the record: {template?.title ?? "Business record"}
                  </Link>
                ) : (
                  <>Fills the record: {template?.title ?? step.record.templateKey}. Saving a number or file below creates it.</>
                )}
                {stepStatus?.hasNumber ? " A number is saved on it (masked)." : ""}
                {stepStatus && stepStatus.fileCount > 0
                  ? ` ${stepStatus.fileCount} file${stepStatus.fileCount === 1 ? "" : "s"} attached.`
                  : ""}
              </p>
            ) : null}
            {showNumber || showFile ? (
              <StepSaveForms
                walkthroughKey={walkthrough.key}
                stepKey={step.key}
                numberLabel={template?.numberLabel ?? null}
                showNumber={showNumber}
                showFile={showFile}
              />
            ) : null}
            {stepStatus?.done && !stepStatus.checked ? (
              <form action={reopenStepAction.bind(null, walkthrough.key, step.key)}>
                <Button type="submit">Mark not done</Button>
              </form>
            ) : !stepStatus?.done ? (
              <form action={markStepDoneAction.bind(null, walkthrough.key, step.key)}>
                <Button type="submit">I did this</Button>
              </form>
            ) : null}
          </Card>
        );
      })}

      {!status?.complete && !status?.dismissed ? (
        <Card title="Not needed?">
          <p>If this walkthrough does not apply to your business, mark it “Not for me” and it leaves your list.</p>
          <form action={dismissWalkthroughAction.bind(null, walkthrough.key)}>
            <Button type="submit">Not for me</Button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
