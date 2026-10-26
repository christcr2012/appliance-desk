// AR-0 kit 4.9: one Today item — eyebrow, title, detail, then the first action as the main button, a second as a
// secondary button, and ⋯ for the rest.
import { ActionButton } from "./action-button";
import { OverflowMenu } from "./overflow-menu";
import { TONE_TEXT, type ActionSpec, type MenuItem, type Tone } from "./types";

export type InboxCardProps = {
  eyebrow: string;
  eyebrowTone: Tone;
  title: string;
  detail?: string;
  actions: ActionSpec[]; // max 2 shown
  overflow?: MenuItem[];
  /** High-severity items get an attention border. */
  severity?: "high" | "normal";
};

export function InboxCard({ eyebrow, eyebrowTone, title, detail, actions, overflow = [], severity = "normal" }: InboxCardProps) {
  const shown = actions.slice(0, 2);
  return (
    <article
      data-severity={severity}
      className={`rounded-card bg-surface px-4 py-3.5 ${severity === "high" ? "border border-warning-bg" : "border border-transparent"}`}
    >
      <p className={`text-xs font-bold ${TONE_TEXT[eyebrowTone]}`}>{eyebrow}</p>
      {/* Titles can hold an email address (a customer with no name): let it wrap so a phone never scrolls sideways. */}
      <h3 className="mt-0.5 text-base font-bold text-ink [overflow-wrap:anywhere]">{title}</h3>
      {detail ? <p className="mt-0.5 text-sm text-ink-soft [overflow-wrap:anywhere]">{detail}</p> : null}
      {shown.length > 0 || overflow.length > 0 ? (
        // Long button words (e.g. "Reconcile uncertain payment") wrap instead of pushing a phone screen sideways.
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {shown.map((spec, index) => (
            <ActionButton
              key={`${spec.kind}-${spec.label}`}
              spec={spec}
              variant={index === 0 ? "primary" : "secondary"}
              className={index === 0 ? "min-w-0 flex-1 whitespace-normal! text-center" : "whitespace-normal! text-center"}
            />
          ))}
          <OverflowMenu items={overflow} label={`More for ${title}`} />
        </div>
      ) : null}
    </article>
  );
}
