// AR-4a kit addition (RENTALS spec section 3): the read-only progress strip
// on a record — where a thing stands, step by step. Display only; the words
// come from the domain (agreementProgress), this just draws them.
import { Icon } from "./icons";
import { InfoTip } from "./info-tip";
import type { GlossaryKey } from "./types";

export type StepperStep = {
  label: string;
  state: "done" | "current" | "waiting" | "problem";
  info?: GlossaryKey;
  /** The step's long words, shown small under the label (RENTALS section 3:
   * the progress sentences are dynamic, so they cannot be glossary keys). */
  detail?: string;
};

const DOT =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold";

export function Stepper({ steps, label }: { steps: StepperStep[]; label: string }) {
  if (steps.length === 0) return null;
  return (
    <ol aria-label={label} className="flex flex-wrap items-start gap-y-3">
      {steps.map((step, index) => (
        <li key={step.label} className="flex min-w-0 items-start">
          {index > 0 ? (
            <span
              aria-hidden="true"
              className={`mx-2 mt-3.5 h-0.5 w-6 shrink-0 sm:w-10 ${
                steps[index - 1].state === "done" ? "bg-success" : "bg-line"
              }`}
            />
          ) : null}
          <span className="flex flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`${DOT} ${
                  step.state === "done"
                    ? "border-success bg-success text-white"
                    : step.state === "problem"
                      ? "border-warning-bg bg-warning-bg text-warning-ink"
                      : step.state === "current"
                        ? "border-primary bg-primary text-white"
                        : "border-line-strong bg-surface text-ink-soft"
                }`}
              >
                {step.state === "done" ? (
                  <Icon name="check" size={20} />
                ) : step.state === "problem" ? (
                  "!"
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={`text-sm ${
                  step.state === "waiting" ? "text-ink-soft" : "font-semibold text-ink"
                }`}
              >
                {step.label}
                <span className="sr-only">
                  {step.state === "done"
                    ? " (done)"
                    : step.state === "problem"
                      ? " (needs attention)"
                      : step.state === "current"
                        ? " (current step)"
                        : " (not yet)"}
                </span>
              </span>
              {step.info ? <InfoTip term={step.info} /> : null}
            </span>
            {step.detail ? (
              <span className="pl-9 text-xs font-normal text-ink-soft">{step.detail}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
