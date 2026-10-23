"use client";

/**
 * A plain-looking "Are you sure?" box that matches the site, works with a keyboard and screen reader,
 * and replaces the browser's own pop-up. Resolves true only when the person presses the confirm button;
 * Escape, the Cancel button, or clicking outside all mean "no".
 */
export function confirmAction(
  message: string,
  options: { confirmLabel?: string; cancelLabel?: string; title?: string } = {},
): Promise<boolean> {
  if (typeof document === "undefined" || typeof HTMLDialogElement === "undefined") return Promise.resolve(false);
  const { confirmLabel = "Yes, continue", cancelLabel = "Cancel", title = "Please confirm" } = options;

  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.createElement("dialog");
    dialog.className =
      "m-auto w-[min(92vw,28rem)] rounded-card border border-line bg-surface p-6 text-ink shadow-xl backdrop:bg-black/50";
    dialog.setAttribute("aria-labelledby", "confirm-action-title");
    dialog.setAttribute("aria-describedby", "confirm-action-body");

    const heading = document.createElement("h2");
    heading.id = "confirm-action-title";
    heading.className = "text-lg font-semibold";
    heading.textContent = title;

    const body = document.createElement("div");
    body.id = "confirm-action-body";
    body.className = "mt-3 space-y-2 text-sm text-ink-soft";
    for (const paragraph of message.split(/\n{2,}/)) {
      const p = document.createElement("p");
      p.textContent = paragraph.trim();
      if (p.textContent) body.appendChild(p);
    }

    const actions = document.createElement("div");
    actions.className = "mt-6 flex flex-wrap justify-end gap-3";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = cancelLabel;
    cancel.className = "min-h-11 rounded-control border border-control bg-surface px-4 py-2 font-semibold text-ink hover:bg-subtle";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.textContent = confirmLabel;
    confirm.className = "min-h-11 rounded-control bg-action px-4 py-2 font-semibold text-on-action hover:opacity-90";
    actions.append(cancel, confirm);
    dialog.append(heading, body, actions);

    let answer = false;
    const finish = () => {
      dialog.close();
    };
    cancel.addEventListener("click", finish);
    confirm.addEventListener("click", () => {
      answer = true;
      finish();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) finish();
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      previous?.focus?.();
      resolve(answer);
    });

    document.body.appendChild(dialog);
    dialog.showModal();
    // Start on the safe choice so a stray Enter key never confirms something risky.
    cancel.focus();
  });
}

/** A one-button notice that replaces `window.alert`. */
export async function noticeAction(message: string, title = "Heads up"): Promise<void> {
  await confirmAction(message, { confirmLabel: "OK", cancelLabel: "Close", title });
}

/** Button and heading words for a customer-facing box, in the customer's language (pass the portal's `tr`). */
export function customerConfirmLabels(tr: (text: "Please confirm" | "Yes, continue" | "Cancel") => string) {
  return { title: tr("Please confirm"), confirmLabel: tr("Yes, continue"), cancelLabel: tr("Cancel") };
}
