import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui";
import { previewSmsTemplate, type VariableRules } from "@/domains/messaging/sms-template";
import { previewDayOfReminder } from "@/domains/messaging/job-reminder-template";
import { communicationsPolicySchema } from "@/domains/messaging/communications-policy";

export async function SmsTemplatePreview() {
  // Read only: COM-L6B adds an approval/editor workflow. A preview never
  // authorizes SMS sending or displays private recipient data.
  const settings = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { communicationsPolicy: true, communicationsPolicyVersion: true },
  });
  const parsed = communicationsPolicySchema.safeParse(settings?.communicationsPolicy);
  const limit = parsed.success && parsed.data.approvedPolicyVersion === settings?.communicationsPolicyVersion
    ? parsed.data.maxSegments : 3;
  const revisions = await prisma.communicationTemplateRevision.findMany({
    where: { channel: "SMS", isCurrent: true },
    orderBy: [{ key: "asc" }, { revision: "desc" }],
    take: 20,
    select: { id: true, key: true, revision: true, body: true,
      approvedAt: true, approvedByUserId: true, variables: true },
  });
  const reminder = previewDayOfReminder(limit);
  return (
    <div className="space-y-6">
      <Card title="Scheduled job reminder (review only)" description="Legacy cron sending is held until a consent-checked, owner-approved automation is implemented.">
        <p className="whitespace-pre-wrap text-sm">{reminder.sample.text}</p>
        <p className="mt-2 text-sm text-ink-soft">
          Sample: {reminder.sample.sms.segments} segments ({reminder.sample.sms.encoding});
          maximum example: {reminder.worstCase.sms.segments} segments ({reminder.worstCase.sms.encoding}).
          Configured preview ceiling: {limit} segments. Carrier costs not verified. No customer message was sent.
        </p>
        {reminder.warning && <p className="text-sm text-ink-soft">{reminder.warning}</p>}
      </Card>
      <Card title="SMS template previews" description="Read-only estimates. No text is sent and no cost is charged.">
      {revisions.length === 0 ? (
        <p className="text-sm text-ink-soft">No current SMS template revisions. Message sending remains off.</p>
      ) : (
        <div className="space-y-5">
          {revisions.map(row => {
            let preview: ReturnType<typeof previewSmsTemplate> | null = null;
            try { preview = previewSmsTemplate(row.body, row.variables as VariableRules, limit); }
            catch { /* malformed stored template must never be silently approved */ }
            return (
              <section key={row.id} className="border-b border-line pb-4">
                <h3 className="font-semibold">{row.key} · revision {row.revision}</h3>
                <p className="text-sm text-ink-soft">
                  {row.approvedAt && row.approvedByUserId
                    ? "Revision approved; sender approval is separate"
                    : "Unapproved draft — cannot send"}
                </p>
                {!preview ? (
                  <p role="alert" className="text-sm text-danger">Invalid template or variable rules. Review before use.</p>
                ) : (
                  <>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{preview.sample.text}</p>
                    <p className="mt-2 text-sm">
                      Example: {preview.sample.sms.segments} segments ({preview.sample.sms.encoding});
                      conservative variable preview: {preview.worstCase.sms.segments} segments
                      ({preview.worstCase.sms.encoding}).
                    </p>
                    <p className="text-xs text-ink-soft">
                      Price unavailable until carrier rates are verified; actual rendered text is checked again before dispatch.
                    </p>
                    {preview.warning && <p className="text-sm text-ink-soft">{preview.warning}</p>}
                  </>
                )}
              </section>
            );
          })}
        </div>
      )}
      </Card>
    </div>
  );
}
