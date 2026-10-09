import { prisma } from "@/lib/prisma";

export type AutomationHealthState =
  | "healthy"
  | "failing"
  | "unknown"
  | "never-ran"
  | "paused"
  | "unconfigured";

export type AutomationRuleDefinition = {
  ruleKey: string;
  label: string;
  explanation: string;
  requiredEnv: string[];
  resolutionHref: string;
  expectedEveryHours: 24 | 168 | 744;
};

export const AUTOMATION_RULES: AutomationRuleDefinition[] = [
  { ruleKey: "backup", label: "Daily backup", explanation: "Exports the business database to the private backup store.", requiredEnv: ["CRON_SECRET", "BLOB_READ_WRITE_TOKEN"], expectedEveryHours: 24, resolutionHref: "/desk/automations#backup" },
  { ruleKey: "media-copy", label: "Private media recovery copy", explanation: "Inventories private photo evidence and keeps a second recoverable copy without resurrecting privacy-deleted files.", requiredEnv: ["CRON_SECRET", "BLOB_READ_WRITE_TOKEN", "PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN", "PRIVATE_PHOTO_BLOB_STORE_ID"], expectedEveryHours: 24, resolutionHref: "/desk/automations#media-copy" },
  { ruleKey: "billing-reconcile:provider-ops", label: "Billing provider operations", explanation: "Reconciles durable Stripe operations that are still pending or uncertain.", requiredEnv: ["CRON_SECRET"], expectedEveryHours: 24, resolutionHref: "/desk/automations#billing-reconcile-provider-ops" },
  { ruleKey: "billing-reconcile:job-handoffs", label: "Job billing handoffs", explanation: "Finishes billing and credit work queued by completed field jobs.", requiredEnv: ["CRON_SECRET"], expectedEveryHours: 24, resolutionHref: "/desk/automations#billing-reconcile-job-handoffs" },
  { ruleKey: "billing-reconcile:invoice-artifacts", label: "Invoice evidence freeze", explanation: "Freezes immutable evidence for invoices that reached a final state.", requiredEnv: ["CRON_SECRET"], expectedEveryHours: 24, resolutionHref: "/desk/automations#billing-reconcile-invoice-artifacts" },
  { ruleKey: "billing-reconcile:retail-delivery-fees", label: "Retail delivery fee reconciliation", explanation: "Reconciles issued RDF evidence and liabilities without double-posting.", requiredEnv: ["CRON_SECRET"], expectedEveryHours: 24, resolutionHref: "/desk/automations#billing-reconcile-retail-delivery-fees" },
  { ruleKey: "billing-reconcile:retail-delivery-fee-charges", label: "Retail delivery fee charges", explanation: "Rechecks eligible RDF charges without inventing a new provider intent.", requiredEnv: ["CRON_SECRET"], expectedEveryHours: 24, resolutionHref: "/desk/automations#billing-reconcile-retail-delivery-fee-charges" },
  { ruleKey: "billing-reconcile:message-deliveries", label: "Message delivery reconciliation", explanation: "Checks uncertain email and text outcomes that already have a provider message id without sending them again.", requiredEnv: ["CRON_SECRET"], expectedEveryHours: 24, resolutionHref: "/desk/automations#billing-reconcile-message-deliveries" },
  { ruleKey: "billing-reminders", label: "Billing reminders", explanation: "Queues each customer's upcoming-payment reminder once per billing cycle.", requiredEnv: ["CRON_SECRET"], expectedEveryHours: 24, resolutionHref: "/desk/automations#billing-reminders" },
  { ruleKey: "estimate-follow-ups", label: "Estimate follow-ups", explanation: "Follows up once on sent estimates that have not received a response.", requiredEnv: ["CRON_SECRET"], expectedEveryHours: 24, resolutionHref: "/desk/automations#estimate-follow-ups" },
  { ruleKey: "job-reminders", label: "Job day-of reminders", explanation: "Sends opted-in customers their same-day service reminder.", requiredEnv: ["CRON_SECRET"], expectedEveryHours: 24, resolutionHref: "/desk/automations#job-reminders" },
  { ruleKey: "late-fees", label: "Late fees", explanation: "Applies configured late-payment fees to eligible invoices and records the result.", requiredEnv: ["CRON_SECRET"], expectedEveryHours: 24, resolutionHref: "/desk/automations#late-fees" },
  { ruleKey: "tax-filing-calendar", label: "Tax filing calendar", explanation: "Creates filing periods, sends Owner-only due and license reminders, and records automation outcomes without sending customer messages.", requiredEnv: ["CRON_SECRET"], expectedEveryHours: 24, resolutionHref: "/desk/automations#tax-filing-calendar" },
  { ruleKey: "tax-rate-changes", label: "Sales-tax rate changes", explanation: "Applies tax-rate versions that start tomorrow to affected live Stripe subscriptions without proration.", requiredEnv: ["CRON_SECRET"], expectedEveryHours: 24, resolutionHref: "/desk/automations#tax-rate-changes" },
  { ruleKey: "tax-address-recheck", label: "Sales-tax address re-check", explanation: "Re-checks current tax areas on the scheduled Colorado calendar and flags jurisdiction changes for review.", requiredEnv: ["CRON_SECRET"], expectedEveryHours: 24, resolutionHref: "/desk/automations#tax-address-recheck" },
  { ruleKey: "tax-rate-watch", label: "Official sales-tax source watch", explanation: "Checks approved official tax pages on the scheduled Colorado calendar and surfaces page changes or repeated fetch failures without interpreting them as tax-law changes.", requiredEnv: ["CRON_SECRET"], expectedEveryHours: 168, resolutionHref: "/desk/automations#tax-rate-watch" },
  { ruleKey: "launch-emails", label: "Launch sequence", explanation: "Advances the finite prelaunch email sequence for eligible subscribers.", requiredEnv: ["CRON_SECRET"], expectedEveryHours: 24, resolutionHref: "/desk/automations#launch-emails" },
  { ruleKey: "start-renewals:auto-renewals", label: "Auto-renewal queue", explanation: "Queues or cancels renewal records according to each customer's current preference.", requiredEnv: ["CRON_SECRET"], expectedEveryHours: 24, resolutionHref: "/desk/automations#start-renewals-auto-renewals" },
  { ruleKey: "start-renewals:annual-reminders", label: "Annual rental reminders", explanation: "Queues the annual month-to-month reminder when its notice window arrives.", requiredEnv: ["CRON_SECRET"], expectedEveryHours: 24, resolutionHref: "/desk/automations#start-renewals-annual-reminders" },
  { ruleKey: "start-renewals:pending-notices", label: "Pending customer notices", explanation: "Attempts delivery of already-created customer notices without inventing new notice obligations.", requiredEnv: ["CRON_SECRET"], expectedEveryHours: 24, resolutionHref: "/desk/automations#start-renewals-pending-notices" },
  { ruleKey: "start-renewals:billing-extensions", label: "Renewal billing extensions", explanation: "Extends provider billing only after the required renewal notice evidence is delivered.", requiredEnv: ["CRON_SECRET"], expectedEveryHours: 24, resolutionHref: "/desk/automations#start-renewals-billing-extensions" },
  { ruleKey: "system-issues-sweep", label: "System health checks", explanation: "Checks known system problems without acting on billing or providers.", requiredEnv: ["CRON_SECRET"], expectedEveryHours: 24, resolutionHref: "/desk/automations#system-issues-sweep" },
  { ruleKey: "start-renewals:due-terminations", label: "Due early endings", explanation: "Executes approved early-ending dates and records fees or items needing review.", requiredEnv: ["CRON_SECRET"], expectedEveryHours: 24, resolutionHref: "/desk/automations#start-renewals-due-terminations" },
  { ruleKey: "start-renewals:close-returns", label: "Returned rental closure", explanation: "Closes rentals whose equipment is fully returned and whose agreed ending has arrived.", requiredEnv: ["CRON_SECRET"], expectedEveryHours: 24, resolutionHref: "/desk/automations#start-renewals-close-returns" },
  { ruleKey: "start-renewals:start-due-renewals", label: "Due renewal start", explanation: "Starts signed renewals whose effective date has arrived and ends the prior agreement safely.", requiredEnv: ["CRON_SECRET"], expectedEveryHours: 24, resolutionHref: "/desk/automations#start-renewals-start-due-renewals" },
];

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export async function getAutomationHealth(now = new Date()) {
  const settings = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { pausedAutomations: true },
  });
  const paused = new Set(stringArray(settings?.pausedAutomations));
  const rows = await prisma.automationRun.findMany({
    where: { ruleKey: { in: AUTOMATION_RULES.map((rule) => rule.ruleKey) } },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
  });
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = grouped.get(row.ruleKey) ?? [];
    list.push(row);
    grouped.set(row.ruleKey, list);
  }

  return AUTOMATION_RULES.map((rule) => {
    const history = grouped.get(rule.ruleKey) ?? [];
    const latest = history[0];
    const success = history.find((row) => row.state === "SUCCEEDED");
    const failure = history.find((row) => row.state === "FAILED");
    const missingEnv = rule.requiredEnv.some((name) => !process.env[name]);
    let state: AutomationHealthState;
    if (paused.has(rule.ruleKey)) state = "paused";
    else if (missingEnv) state = "unconfigured";
    else if (!latest) state = "never-ran";
    else if (latest.state === "SUCCEEDED") state = "healthy";
    else if (latest.state === "FAILED") state = "failing";
    else state = "unknown";

    return {
      ruleKey: rule.ruleKey,
      label: rule.label,
      explanation: rule.explanation,
      lastSuccessAt: success?.finishedAt ?? success?.startedAt ?? null,
      lastFailure: failure
        ? { at: failure.finishedAt ?? failure.startedAt, error: failure.error ?? "Automation failed." }
        : null,
      state,
      resolutionHref: rule.resolutionHref,
      checkedAt: now,
    };
  });
}

export async function setAutomationPaused(actorUserId: string, ruleKey: string, shouldPause: boolean): Promise<void> {
  if (!AUTOMATION_RULES.some((rule) => rule.ruleKey === ruleKey)) throw new Error("Unknown automation rule.");
  await prisma.$transaction(async (tx) => {
    const settings = await tx.businessSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton" },
      update: {},
      select: { pausedAutomations: true },
    });
    const before = stringArray(settings.pausedAutomations);
    const next = shouldPause
      ? [...new Set([...before, ruleKey])].sort()
      : before.filter((key) => key !== ruleKey);
    if (JSON.stringify(before) === JSON.stringify(next)) return;
    await tx.businessSettings.update({ where: { id: "singleton" }, data: { pausedAutomations: next } });
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: shouldPause ? "automation.pause" : "automation.resume",
        entityType: "AutomationRule",
        entityId: ruleKey,
        oldValue: { paused: before.includes(ruleKey) },
        newValue: { paused: shouldPause },
      },
    });
  });
}
