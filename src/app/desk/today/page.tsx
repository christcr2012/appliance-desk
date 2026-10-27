import Link from "next/link";
import { revalidatePath } from "next/cache";
import { getExceptionOverview, getTodaysJobs, type ExceptionItem } from "@/domains/exceptions";
import { syncComplianceFilings } from "@/domains/compliance/filings";
import {
  INBOX_GROUP,
  INBOX_GROUP_LABEL,
  INBOX_GROUP_ORDER,
  inboxActions,
  inboxEyebrow,
  inboxEyebrowTone,
  sortInbox,
  type InboxGroup,
} from "@/domains/exceptions/inbox";
import { manuallyApplyObservedRate, undoAutoAppliedRateVersion } from "@/domains/tax/official-rate-auto-apply";
import { approveRdfSwitch } from "@/domains/tax/rdf-switches";
import { confirmFilingFrequencyAdvice } from "@/domains/tax/filing-frequency-advice";
import { approveRuleChange, dismissRuleChange } from "@/domains/rules/observations";
import { acknowledgeOfficialSourceChange } from "@/domains/tax/official-source-watch";
import { snoozeTodo, todoDeadlineLabel, unsnoozeTodo } from "@/domains/exceptions/todo";
import { getDueTaskSummary } from "@/domains/tasks/workspace";
import { completeTaskAction } from "../tasks/actions";
import { getSetupChecklist } from "@/domains/setup/checklist";
import { getBudgetPlanning } from "@/domains/budget/planning";
import { getWeeklyHealth, type WeeklyHealth } from "@/domains/dashboard/weekly-health";
import { getWorkspace, describeSavedView, savedViewHref, usablePins } from "@/domains/workspace";
import { requireRole } from "@/lib/session";
import { addBusinessDays, businessDateKey, formatBusinessTime, formatShortDate, formatWeekdayDate } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { jobTypeLabel } from "@/lib/status-labels";
import { visibleOwnerActions } from "@/lib/owner-actions";
import { ActionButton, AutoRefresh, PullToRefresh, EmptyState, Icon, InboxCard, InfoTip, StatusTabs, TONE_DOT, Toaster, mapHref, type ActionSpec, type Tone } from "@/components/kit";
import { SetupCard } from "./setup-card";
import { decisionsTodayCount } from "@/domains/decisions/today";
import { recordBankPaymentAction } from "../billing/reconciliation/actions";
import { TodayInbox, type InboxEntry } from "./today-inbox";

export const metadata = { title: "Today" };

async function acknowledgeTaxSourceAction(formData: FormData) {
  "use server";
  const watchId = formData.get("watchId");
  const watchVersion = formData.get("watchVersion");
  if (
    typeof watchId !== "string" ||
    !watchId ||
    watchId.length > 200 ||
    typeof watchVersion !== "string" ||
    !/^[a-f0-9]{64}:\d{1,16}$/.test(watchVersion)
  ) {
    return;
  }
  await acknowledgeOfficialSourceChange(watchId, watchVersion);
  revalidatePath("/desk/today");
}

async function undoOfficialRateAction(formData: FormData) {
  "use server";
  const session = await requireRole("OWNER");
  const rateVersionId = formData.get("rateVersionId");
  if (typeof rateVersionId !== "string" || !rateVersionId || rateVersionId.length > 200) {
    return;
  }
  await undoAutoAppliedRateVersion({
    rateVersionId,
    actorUserId: session.user.id,
  });
  revalidatePath("/desk/today");
}

async function applyOfficialRateAction(formData: FormData) {
  "use server";
  const session = await requireRole("OWNER");
  const observationId = formData.get("observationId");
  if (typeof observationId !== "string" || !observationId || observationId.length > 200) {
    return;
  }
  await manuallyApplyObservedRate({
    observationId,
    actorUserId: session.user.id,
  });
  revalidatePath("/desk/today");
}

async function approveRuleChangeAction(formData: FormData) {
  "use server";
  const session = await requireRole("OWNER");
  const observationId = formData.get("observationId");
  if (typeof observationId !== "string" || !observationId || observationId.length > 200) {
    return;
  }
  await approveRuleChange(observationId, session.user.id);
  revalidatePath("/desk/today");
}

async function dismissRuleChangeAction(formData: FormData) {
  "use server";
  const session = await requireRole("OWNER");
  const observationId = formData.get("observationId");
  if (typeof observationId !== "string" || !observationId || observationId.length > 200) {
    return;
  }
  const note = formData.get("note");
  await dismissRuleChange(observationId, session.user.id, typeof note === "string" ? note : "");
  revalidatePath("/desk/today");
}

async function approveRdfSwitchAction(formData: FormData) {
  "use server";
  const session = await requireRole("OWNER");
  const switchId = formData.get("switchId");
  if (typeof switchId !== "string" || !switchId || switchId.length > 200) {
    return;
  }
  await approveRdfSwitch(session.user.id, switchId);
  revalidatePath("/desk/today");
}

async function confirmFilingFrequencyAction(formData: FormData) {
  "use server";
  const session = await requireRole("OWNER");
  const adviceId = formData.get("adviceId");
  if (typeof adviceId !== "string" || !adviceId || adviceId.length > 200) {
    return;
  }
  await confirmFilingFrequencyAdvice(session.user.id, adviceId);
  revalidatePath("/desk/today");
}

async function snoozeToDoAction(formData: FormData) {
  "use server";
  const session = await requireRole("OWNER", "ADMIN");
  const key = formData.get("key");
  const until = formData.get("until");
  const reason = formData.get("reason");
  if (typeof key !== "string" || typeof until !== "string" || typeof reason !== "string")
    throw new Error("Complete the snooze form.");
  const overview = await getExceptionOverview();
  await snoozeTodo({ key, until, reason, actorUserId: session.user.id,
    active: [...overview.items, ...overview.snoozed] });
  revalidatePath("/desk/today");
}
async function resumeToDoAction(formData: FormData) {
  "use server";
  const session = await requireRole("OWNER", "ADMIN");
  const key = formData.get("key");
  if (typeof key !== "string") throw new Error("Invalid To do item.");
  await unsnoozeTodo({ key, actorUserId: session.user.id });
  revalidatePath("/desk/today");
}

/** "Done" on a task card: the same versioned completeTaskAction the Tasks list uses. */
async function completeTaskFromTodayAction(formData: FormData) {
  "use server";
  const id = formData.get("taskId");
  const version = Number(formData.get("version"));
  if (typeof id !== "string" || !id || !Number.isSafeInteger(version)) return { error: "This task changed. Refresh and try again." };
  const result = await completeTaskAction(id, version);
  return result.status === "success" ? { success: "Task done" } : { error: result.message };
}

type Search = { screen?: string; group?: string; snooze?: string };
type Group = InboxGroup | "all" | "snoozed";

function parseGroup(value: string | undefined): Group {
  if (value === "snoozed" || value === "all") return value;
  return INBOX_GROUP_ORDER.find((group) => group === value) ?? "all";
}

function initials(name: string | null | undefined, email: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (email ?? "?").slice(0, 1).toUpperCase();
}

function HealthStrip({ health }: { health: WeeklyHealth }) {
  const cells: { label: string; value: string; tone: Tone; info: "week-money-in" | "out-renting" | "overdue-bills" }[] = [
    { label: "Money in", value: formatMoney(health.moneyInCents), tone: health.moneyInCents > 0 ? "good" : "neutral", info: "week-money-in" },
    { label: "Out renting", value: `${health.outRenting} of ${health.rentableTotal}`, tone: "neutral", info: "out-renting" },
    {
      label: "Overdue",
      value: health.overdueBills > 0 ? `${health.overdueBills} ${health.overdueBills === 1 ? "bill" : "bills"}` : "None",
      tone: health.overdueBills > 0 ? "attention" : "good",
      info: "overdue-bills",
    },
  ];
  return (
    <section aria-label="Your business this week" className="grid grid-cols-3 gap-2 rounded-card bg-surface px-4 py-3.5 lg:grid-cols-1 lg:gap-3">
      {cells.map((cell) => (
        <div key={cell.label} className="min-w-0 lg:flex lg:items-center lg:justify-between">
          <p className="flex items-center gap-1.5 text-xs font-bold text-ink-soft">
            <span aria-hidden="true" data-tone={cell.tone} className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[cell.tone]}`} />
            {cell.label}
            <InfoTip term={cell.info} />
          </p>
          <p
            className={`mt-0.5 text-lg font-extrabold tabular-nums lg:mt-0 ${cell.tone === "attention" ? "text-warning-ink" : "text-ink"}`}
          >
            {cell.value}
          </p>
        </div>
      ))}
    </section>
  );
}

export default async function TodayPage({ searchParams }: { searchParams?: Promise<Search> } = {}) {
  const query: Search = (await searchParams) ?? {};
  // ACC-5: sent here when a job role does not include the screen they tried to open.
  const notInJobRole = query.screen === "not-in-job-role";
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const role = (session.user as { role?: string }).role ?? "";
  const canManage = role === "OWNER" || role === "ADMIN";
  const now = new Date();
  // CMP-1: keep the compliance filing rows fresh on the attention surface
  // itself, so a filing reminder never depends on opening Compliance first.
  // A sync failure must never take Today down — the reminders simply wait
  // for the next load, like the setup checklist below.
  if (canManage) await syncComplianceFilings(now).catch(() => undefined);
  const group = parseGroup(query.group);

  // The first-time setup checklist is for the owner only. getSetupChecklist refuses anyone else itself;
  // the role test here just avoids asking. A failure must never take Today down, so it only hides the card.
  const setupChecklist = role === "OWNER"
    ? await getSetupChecklist(session.user.id).catch((error: unknown) => {
        console.error("Setup checklist unavailable:", error instanceof Error ? error.message : "unknown error");
        return null;
      })
    : null;

  const budgetAttention = canManage
    ? await getBudgetPlanning(session.user.id, businessDateKey(now))
        .then((data) => ({
          unpaid: data.upcoming.filter((x) => x.unpaidCents > 0 && x.dueOn <= businessDateKey(addBusinessDays(now, 30))).length,
          short: data.envelopes.filter((x) => x.needCents > 0 || x.balanceCents < 0).length,
          review: data.sourceReasons.length,
        }))
        .catch(() => null)
    : null;

  const [{ items: allExceptions, snoozed, truncated: allTruncated }, jobs, followUps, health] = await Promise.all([
    getExceptionOverview(),
    getTodaysJobs(now),
    getDueTaskSummary(now),
    // Money numbers are for owners and admins only; a problem reading them only hides the strip.
    canManage ? getWeeklyHealth(now).catch(() => null) : Promise.resolve(null),
  ]);

  // O-7: a private workspace for the owner and admins. A problem reading it only hides the shortcuts; it never hides work.
  // Only the optional notes (goal, idle appliances, low use) can be hidden; every other item always shows.
  const workspace = canManage ? await getWorkspace(session.user.id).catch(() => null) : null;
  // DEC-1b: "Decisions waiting" — owner only, low priority, at most one day a week.
  const decisionsWaiting = await decisionsTodayCount({ id: session.user.id, role }, now);
  const hiddenOptional = new Set(workspace?.prefs.hiddenOptionalCardIds ?? []);
  const exceptions = sortInbox(allExceptions.filter((item) => !hiddenOptional.has(item.category)));
  const truncated = allTruncated.filter((item) => !hiddenOptional.has(item.category));
  const hiddenNoteCount = allExceptions.filter((item) => hiddenOptional.has(item.category)).length;
  const myPins = workspace ? usablePins(workspace.prefs, visibleOwnerActions(role)) : [];
  const mySavedViews = workspace?.prefs.savedViews ?? [];

  const handlers =
    role === "OWNER"
      ? { acknowledgeTaxSource: acknowledgeTaxSourceAction, applyOfficialRate: applyOfficialRateAction, undoOfficialRate: undoOfficialRateAction, recordBankPayment: recordBankPaymentAction, approveRdfSwitch: approveRdfSwitchAction, confirmFilingFrequency: confirmFilingFrequencyAction, approveRuleChange: approveRuleChangeAction, dismissRuleChange: dismissRuleChangeAction }
      : role === "ADMIN"
        ? { recordBankPayment: recordBankPaymentAction }
        : undefined;
  const groupParam = group === "all" || group === "snoozed" ? null : group;
  const snoozeHref = canManage
    ? (key: string) => `/desk/today?${new URLSearchParams({ ...(groupParam ? { group: groupParam } : {}), snooze: key }).toString()}`
    : undefined;

  const itemCard = (item: ExceptionItem, index: number, bringBack = false): InboxEntry => {
    const key = `${item.todoKey ?? item.category + "-" + index}`;
    const { actions, overflow } = bringBack
      ? {
          actions: [
            {
              kind: "form",
              label: "Bring back",
              action: resumeToDoAction,
              fields: { key: item.todoKey ?? "" },
              primary: true,
              pendingLabel: "Bringing back…",
              successMessage: "Brought back to your To do list",
            } satisfies ActionSpec,
            { kind: "link", label: "Open", href: item.href } satisfies ActionSpec,
          ],
          overflow: [],
        }
      : inboxActions(item, { handlers, snoozeHref });
    const until = item.snooze ? `Snoozed until ${formatShortDate(item.snooze.until, now)}` : null;
    return {
      key,
      todoKey: item.todoKey,
      title: item.title,
      node: (
        <InboxCard
          eyebrow={bringBack && until ? `${INBOX_GROUP_LABEL[INBOX_GROUP[item.category]]} · ${until}` : inboxEyebrow(item, now)}
          eyebrowTone={bringBack ? "neutral" : inboxEyebrowTone(item)}
          title={item.title}
          detail={item.detail}
          actions={actions}
          overflow={overflow}
          severity={item.severity === "high" && !bringBack ? "high" : "normal"}
        />
      ),
    };
  };

  const budgetEntry: InboxEntry | null =
    budgetAttention && (budgetAttention.unpaid > 0 || budgetAttention.short > 0 || budgetAttention.review > 0)
      ? {
          key: "budget",
          title: "Check your budget",
          node: (
            <InboxCard
              eyebrow="Money · Budget"
              eyebrowTone="neutral"
              title="Check your budget"
              detail={[
                budgetAttention.unpaid > 0 ? `${budgetAttention.unpaid} unpaid ${budgetAttention.unpaid === 1 ? "bill" : "bills"} due in 30 days` : null,
                budgetAttention.short > 0 ? `${budgetAttention.short} ${budgetAttention.short === 1 ? "savings goal" : "savings goals"} short` : null,
                budgetAttention.review > 0 ? "bank source needs a look" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              actions={[{ kind: "link", label: "Review budget", href: "/desk/books/budget?tab=plan", primary: true }]}
            />
          ),
        }
      : null;

  const taskEntries: InboxEntry[] = followUps.tasks.map((task) => {
    const deadline = todoDeadlineLabel(task.dueDate ?? undefined, now, true);
    const about = task.customer ? task.customer.user.name ?? task.customer.user.email : task.lead?.contactName ?? null;
    return {
      key: `task-${task.id}`,
      title: task.note,
      node: (
        <InboxCard
          eyebrow={["Tasks", deadline].filter(Boolean).join(" · ")}
          eyebrowTone={deadline?.startsWith("Overdue") ? "attention" : "neutral"}
          title={task.note}
          detail={about ?? undefined}
          actions={[
            {
              kind: "form",
              label: "Done",
              action: completeTaskFromTodayAction,
              fields: { taskId: task.id, version: String(task.version) },
              primary: true,
              pendingLabel: "Saving…",
            },
            { kind: "link", label: "Open tasks", href: "/desk/tasks" },
          ]}
        />
      ),
    };
  });

  const byGroup = new Map<InboxGroup, ExceptionItem[]>();
  for (const item of exceptions) {
    const g = INBOX_GROUP[item.category];
    byGroup.set(g, [...(byGroup.get(g) ?? []), item]);
  }
  const extra = (g: InboxGroup) =>
    truncated.filter((t) => INBOX_GROUP[t.category] === g).reduce((sum, t) => sum + Math.max(0, t.total - t.shown), 0);
  const groupCount = (g: InboxGroup) =>
    g === "tasks"
      ? followUps.totalCount
      : (byGroup.get(g)?.length ?? 0) + extra(g) + (g === "money" && budgetEntry ? 1 : 0);
  const total = INBOX_GROUP_ORDER.reduce((sum, g) => sum + groupCount(g), 0);

  const entries: InboxEntry[] =
    group === "snoozed"
      ? snoozed.map((item, index) => itemCard(item, index, true))
      : [
          ...(group === "all" || group === "money" ? (budgetEntry ? [budgetEntry] : []) : []),
          ...exceptions.filter((item) => group === "all" || INBOX_GROUP[item.category] === group).map((item, index) => itemCard(item, index)),
          ...(group === "all" || group === "tasks" ? taskEntries : []),
        ];

  const truncationLines = (group === "all" ? INBOX_GROUP_ORDER : group === "snoozed" ? [] : [group]).flatMap((g): { g: InboxGroup; text: string }[] => {
    if (g === "tasks") {
      return followUps.totalCount > followUps.tasks.length
        ? [{ g, text: `Showing ${followUps.tasks.length} of ${followUps.totalCount}` }]
        : [];
    }
    const rows = truncated.filter((t) => INBOX_GROUP[t.category] === g);
    if (rows.length === 0) return [];
    const shown = byGroup.get(g)?.length ?? 0;
    return [{ g, text: `Showing ${shown} of ${shown + extra(g)}` }];
  });

  const visits = jobs.filter((job) => job.status !== "CANCELLED");
  const dates = {
    min: businessDateKey(addBusinessDays(now, 1)),
    max: businessDateKey(addBusinessDays(now, 90)),
    initial: businessDateKey(addBusinessDays(now, 3)),
  };

  const visitsSection = (
    <section aria-labelledby="today-visits" className="flex flex-col gap-2.5">
      <h2 id="today-visits" className="text-base font-bold text-ink">
        Today&apos;s visits
      </h2>
      {visits.length === 0 ? (
        <EmptyState title="No visits today" />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {visits.map((job) => {
            const start = job.scheduledAt;
            const end = start ? new Date(start.getTime() + job.durationMinutes * 60_000) : null;
            const address = job.serviceAddress ? `${job.serviceAddress.line1}, ${job.serviceAddress.city}` : undefined;
            const actions: ActionSpec[] = [{ kind: "link", label: "Open visit", href: `/desk/jobs/${job.id}`, primary: true }];
            if (address) actions.push({ kind: "link", label: "Directions", href: mapHref(address) });
            return (
              <li key={job.id}>
                <InboxCard
                  eyebrow={`Visit · ${start && end ? `${formatBusinessTime(start)}–${formatBusinessTime(end)}` : "time not set"}`}
                  eyebrowTone="info"
                  title={`${jobTypeLabel(job.type)} — ${job.customer?.user.name ?? job.customer?.user.email ?? "Internal job"}`}
                  detail={address}
                  actions={actions}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const shortcuts =
    myPins.length + mySavedViews.length > 0 ? (
      <nav aria-label="My shortcuts" className="flex flex-col gap-2">
        <h2 className="text-base font-bold text-ink">Shortcuts</h2>
        <ul className="flex flex-wrap gap-2">
          {myPins.map((pin) => (
            <li key={pin.id}>
              <ActionButton spec={{ kind: "link", label: pin.label, href: pin.href }} variant="secondary" />
            </li>
          ))}
          {mySavedViews.map((view) => (
            <li key={view.id} title={describeSavedView(view)}>
              <ActionButton spec={{ kind: "link", label: view.label, href: savedViewHref(view) }} variant="secondary" />
            </li>
          ))}
        </ul>
      </nav>
    ) : null;

  const tabs = [
    { value: "all", label: "All", count: total },
    ...INBOX_GROUP_ORDER.filter((g) => groupCount(g) > 0 || g === group).map((g) => ({ value: g, label: INBOX_GROUP_LABEL[g], count: groupCount(g) })),
  ];

  return (
    // The kit lays out for a 20 px phone gutter (KIT 1); the current shell gives 16 px, so add the difference until AR-1.
    <PullToRefresh><div className="w-full min-w-0 max-w-full px-1 sm:px-0 lg:flex lg:items-start lg:gap-6">
      <div className="flex w-full min-w-0 max-w-full flex-1 flex-col gap-4 lg:max-w-[760px]">
        <AutoRefresh />
        {notInJobRole ? (
          <p role="status" className="rounded-card border border-line bg-surface px-4 py-3 text-sm font-semibold text-ink">
            You don&apos;t have access to that screen.
          </p>
        ) : null}
        <header className="flex w-full min-w-0 items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-soft">{formatWeekdayDate(now)}</p>
            <h1 tabIndex={-1} className="text-[28px] leading-8 font-extrabold tracking-[-0.5px] text-ink lg:text-[26px]">
              Today
            </h1>
          </div>
          <Link
            href="/desk/search"
            aria-label="Search"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink hover:bg-tint"
          >
            <Icon name="search" />
          </Link>
          <Link
            href="/desk/account"
            aria-label="Your account"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-extrabold text-on-primary"
          >
            {initials(session.user.name, session.user.email)}
          </Link>
        </header>
        {health ? (
          <div className="lg:hidden">
            <HealthStrip health={health} />
          </div>
        ) : null}
        {setupChecklist ? <SetupCard checklist={setupChecklist} /> : null}
        {decisionsWaiting ? (
          <section aria-label="System">
            <InboxCard
              eyebrow="System"
              eyebrowTone="neutral"
              title={`Decisions waiting: ${decisionsWaiting}`}
              detail="The app is running on starting values. Confirm or change them when you have time."
              actions={[{ kind: "link", label: "Open", href: "/desk/settings/decisions", primary: true }]}
            />
          </section>
        ) : null}
        {group !== "snoozed" ? <StatusTabs label="Inbox groups" param="group" current={group} items={tabs} /> : null}
        {group === "snoozed" ? (
          <div className="flex items-center gap-3">
            <h2 className="flex-1 text-base font-bold text-ink">Snoozed ({snoozed.length})</h2>
            <ActionButton spec={{ kind: "link", label: "Back to To do", href: "/desk/today" }} variant="secondary" />
          </div>
        ) : null}
        {entries.length === 0 ? (
          <EmptyState title={group === "snoozed" ? "Nothing is snoozed" : "You're all caught up"} />
        ) : (
          <TodayInbox
            entries={entries}
            snoozeAction={canManage ? snoozeToDoAction : undefined}
            resumeAction={canManage ? resumeToDoAction : undefined}
            dates={dates}
            initialSnoozeKey={query.snooze}
          >
            {truncationLines.map((line) => (
              <p key={line.g} className="pt-2 text-sm text-ink-soft">
                {group === "all" ? `${INBOX_GROUP_LABEL[line.g]}: ` : ""}
                {line.text}
              </p>
            ))}
          </TodayInbox>
        )}
        {group !== "snoozed" && snoozed.length > 0 ? (
          <Link href="/desk/today?group=snoozed" className="inline-flex min-h-11 items-center self-start text-[15px] font-bold text-primary hover:underline">
            Snoozed ({snoozed.length})
          </Link>
        ) : null}
        {hiddenNoteCount > 0 ? (
          <p className="text-sm text-ink-soft">
            {hiddenNoteCount} optional note{hiddenNoteCount === 1 ? " is" : "s are"} hidden.{" "}
            <Link href="/desk/control-center#my-workspace" className="font-semibold text-primary underline">
              Show again
            </Link>
          </p>
        ) : null}
      </div>
      <Toaster />
      <aside aria-label="Today at a glance" className="mt-6 flex w-full min-w-0 max-w-full flex-col gap-6 lg:mt-0 lg:w-[340px] lg:shrink-0">
        {health ? (
          <div className="hidden lg:block">
            <HealthStrip health={health} />
          </div>
        ) : null}
        {visitsSection}
        {shortcuts}
      </aside>
    </div></PullToRefresh>
  );
}
