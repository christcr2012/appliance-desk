// AR-0 kit shared types (docs/build-specs/KIT.md section 3).
export type Tone = "neutral" | "good" | "attention" | "info" | "danger";
export type ConfirmSpec = { title: string; summary: string; confirmLabel: string; danger?: boolean };

/** A server action as the kit calls it: given the form's fields, resolves when done (or throws a plain message). */
export type FormAction = (fd: FormData) => Promise<unknown>;

export type ActionSpec =
  | { kind: "link"; label: string; href: string; primary?: boolean }
  | { kind: "tel"; label: string; phone: string; primary?: boolean } // renders <a href="tel:…">
  | { kind: "mailto"; label: string; email: string; primary?: boolean }
  | {
      kind: "form";
      label: string;
      action: FormAction;
      fields?: Record<string, string>;
      confirm?: ConfirmSpec;
      undo?: boolean;
      primary?: boolean;
      pendingLabel?: string; // default "Saving…"
      /** Past-tense toast shown on success (KIT 6.2), e.g. "Reminder sent to Maria Lopez". */
      successMessage?: string;
      /** With `undo: true`, the Undo button in the success toast calls this with the same fields. */
      undoAction?: FormAction;
    };

export type MenuItem = ActionSpec & { danger?: boolean };
export type GlossaryKey = import("@/lib/glossary").GlossaryKey;

/** KIT 3 rule: a `form` action with `confirm` never uses `undo` and is never optimistic. */
export function assertActionSpec(spec: ActionSpec): void {
  if (spec.kind === "form" && spec.confirm && spec.undo) {
    throw new Error(`"${spec.label}" asks for a confirmation, so it cannot also offer Undo.`);
  }
}

export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-ink-soft",
  good: "text-success",
  attention: "text-warning-ink",
  info: "text-info-ink",
  danger: "text-danger",
};

export const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-line-strong",
  good: "bg-success",
  attention: "bg-warning-ink",
  info: "bg-info-ink",
  danger: "bg-danger",
};
