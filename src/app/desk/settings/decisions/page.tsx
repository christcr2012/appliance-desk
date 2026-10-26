import { requireRole } from "@/lib/session";
import { businessDateKey, formatShortDate } from "@/lib/business-date";
import { listDecisions, type DecisionCard as Card } from "@/domains/decisions";
import { DECISION_AREAS } from "@/domains/decisions/registry";
import { matchOption } from "@/domains/decisions/rules";
import { NO_SOURCE_WHY, audienceWord } from "@/domains/decisions/form-content";
import {
  DecisionCard,
  EmptyState,
  ScreenHeader,
  Toaster,
  StatusTabs,
  Toolbar,
  type FilterDef,
  type Tone,
} from "@/components/kit";
import { askProfessionalAction, changeDecisionAction, keepDecisionAction, reopenDecisionAction } from "./actions";
import { DecisionActions } from "./decision-actions";
import { decisionsParams, TABS, type DecisionsTab } from "./params";

export const metadata = { title: "Decisions & reviews", robots: { index: false, follow: false } };

// The kit's secondary button look. This is a server component, so it must not call the kit's client-side
// class helper (the server render fails with React error 441 and the whole screen goes down).
const DOWNLOAD_BUTTON = "inline-flex min-h-11 items-center justify-center gap-2 rounded-field border border-line-strong " +
  "bg-surface px-4 text-[15px] font-bold whitespace-nowrap text-ink hover:bg-tint focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-focus-ring lg:min-h-10";

const AREA_WORDS: Record<string, string> = {
  TAX: "Tax", RENTAL_TERMS: "Rental terms", MONEY: "Money", PRIVACY: "Privacy and records", WORDING: "Wording",
  BUSINESS: "Business",
};

const FILTERS: FilterDef[] = [
  { kind: "select", param: "area", label: "Area", options: DECISION_AREAS.map((value) => ({ value, label: AREA_WORDS[value] ?? value })) },
  { kind: "select", param: "state", label: "State", options: [
    { value: "STARTING_VALUE", label: "Starting value" },
    { value: "WITH_PROFESSIONAL", label: "With a professional" },
    { value: "NO_SOURCE", label: "No source yet" },
  ] },
];

function whoConfirmed(card: Card): string {
  const last = card.last;
  if (!last) return "you";
  if (last.professionalName) return last.professionalFirm ? `${last.professionalName}, ${last.professionalFirm}` : last.professionalName;
  return last.answeredByName ?? "the owner";
}

function pillsFor(card: Card, now: Date): { label: string; tone: Tone }[] {
  const pills: { label: string; tone: Tone }[] = [];
  const last = card.last;
  if (card.state === "CONFIRMED" && last) {
    pills.push({ label: `Confirmed by ${whoConfirmed(card)} on ${formatShortDate(last.professionalAnsweredOn ?? last.createdAt, now)}`, tone: "good" });
  } else if (card.state === "WITH_PROFESSIONAL" && last) {
    pills.push({ label: `With your ${audienceWord(card.audience)} since ${formatShortDate(last.createdAt, now)}`, tone: "info" });
  } else if (card.state === "NO_SOURCE") {
    pills.push({ label: "No public source — careful choice in use", tone: "neutral" });
  } else {
    pills.push({ label: "Starting value — not confirmed", tone: "attention" });
  }
  if (card.needsAppChange) pills.push({ label: "Needs a change to the app", tone: "info" });
  return pills;
}

function notesFor(card: Card, tab: DecisionsTab, now: Date): string[] {
  const notes: string[] = [];
  if (card.pending) notes.push(`Starts ${formatShortDate(card.pending.effectiveFrom, now)}: ${card.pending.words}`);
  if (tab === "CPA" || tab === "ATTORNEY" || tab === "TRANSLATOR") {
    notes.push(card.reviewGate ? "Real use waits for this review." : "You can use this now; their answer may change it.");
  }
  if (card.needsAppChange && card.last?.explanation) notes.push(`Their answer: ${card.last.explanation.slice(0, 300)}`);
  return notes;
}

export default async function DecisionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireRole("OWNER", "ADMIN");
  const isOwner = session.user.role === "OWNER";
  const params = decisionsParams(await searchParams);
  const now = new Date();
  const today = businessDateKey(now);
  const all = await listDecisions(session.user.id);
  const open = all.filter((card) => card.state !== "CONFIRMED");
  const count = (tab: DecisionsTab) => tab === "ANSWERED"
    ? all.length - open.length : open.filter((card) => card.audience === tab).length;
  const inTab = params.tab === "ANSWERED"
    ? all.filter((card) => card.state === "CONFIRMED")
    : open.filter((card) => card.audience === params.tab);
  const shown = inTab.filter((card) =>
    (!params.area || card.area === params.area) && (!params.state || params.tab === "ANSWERED" || card.state === params.state));
  const professional = params.tab === "CPA" || params.tab === "ATTORNEY" || params.tab === "TRANSLATOR";
  const word = params.tab === "ANSWERED" ? "" : audienceWord(params.tab);

  return (
    // px-1: the shell's phone gutter is 16 px; the kit's tabs bleed 20 px (KIT spacing), so this keeps them on screen.
    <div className="mx-auto max-w-3xl overflow-x-clip px-1 lg:px-0">
      {/* KIT 4.15 toasts for this screen. AR-0b moves the one Toaster into the desk layout. */}
      <Toaster />
      <ScreenHeader
        title="Decisions & reviews"
        back={{ href: "/desk/settings", label: "Back to settings" }}
        overflow={isOwner ? [{ kind: "link", label: "Import a completed form", href: "/desk/settings/decisions/import" }] : undefined}
      />
      <StatusTabs
        label="Who answers"
        param="for"
        current={params.tab}
        items={TABS.map((tab) => ({
          value: tab,
          label: tab === "OWNER" ? "For you" : tab === "ANSWERED" ? "Answered" : `For your ${audienceWord(tab)}`,
          count: count(tab),
        }))}
      />
      <div className="mt-3 flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <Toolbar filters={params.tab === "ANSWERED" ? FILTERS.slice(0, 1) : FILTERS} />
        </div>
        {professional && inTab.length > 0 ? (
          <div className="flex flex-wrap gap-2" aria-label="Download questions" role="group">
            <a href={`/desk/settings/decisions/form?for=${params.tab}&format=docx`} download className={DOWNLOAD_BUTTON}>Download questions (Word)</a>
            <a href={`/desk/settings/decisions/form?for=${params.tab}&format=pdf`} download className={DOWNLOAD_BUTTON}>Download questions (PDF)</a>
          </div>
        ) : null}
      </div>
      {shown.length === 0 ? (
        <EmptyState title={params.tab === "ANSWERED" ? "Nothing answered yet." : params.tab === "OWNER" ? "Nothing is waiting for you." : `Nothing is waiting for your ${word}.`} />
      ) : (
        <ul className="flex flex-col gap-2.5" aria-label="Questions">
          {shown.map((card) => {
            const currentOption = matchOption(card, card.current.value);
            const currentIndex = currentOption ? card.options.indexOf(currentOption) : null;
            const answered = params.tab === "ANSWERED";
            return (
              <li key={card.id}>
                <DecisionCard
                  title={card.title}
                  question={card.question}
                  doingNow={card.current.words}
                  pills={pillsFor(card, now)}
                  why={{ text: card.recommended?.why ?? NO_SOURCE_WHY, sources: card.recommended?.sources ?? [] }}
                  affects={card.affects}
                  notes={notesFor(card, params.tab, now)}
                  actions={isOwner || card.last?.hasAttachment ? (
                    <>
                      {isOwner ? (
                        <DecisionActions
                          id={card.id}
                          title={card.title}
                          options={card.options.map((option) => ({ label: option.label }))}
                          currentIndex={currentIndex}
                          expected={JSON.stringify(card.current.value)}
                          allowOther={card.allowOther}
                          today={today}
                          show={{
                            keep: !answered && !professional && currentIndex !== null,
                            change: !answered,
                            ask: !answered,
                            answer: !answered && professional,
                            reopen: answered,
                          }}
                          professionals={[card.defaultAudience, "CPA", "ATTORNEY", "TRANSLATOR"]
                            .filter((pro, index, list): pro is "CPA" | "ATTORNEY" | "TRANSLATOR" =>
                              pro !== "OWNER" && pro !== params.tab && list.indexOf(pro) === index)}
                          answerLabel="Enter their answer"
                          actions={{ keep: keepDecisionAction, change: changeDecisionAction, ask: askProfessionalAction,
                            reopen: reopenDecisionAction }}
                        />
                      ) : null}
                      {card.last?.hasAttachment ? (
                        <a href={`/api/desk/decisions/attachments/${card.last.id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-link underline">
                          Their completed form
                        </a>
                      ) : null}
                    </>
                  ) : undefined}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
