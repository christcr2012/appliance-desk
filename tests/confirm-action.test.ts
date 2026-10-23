// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { confirmAction } from "@/lib/confirm-action";

// jsdom does not implement <dialog>.showModal/close; a tiny stand-in lets us test the buttons and the answer.
beforeAll(() => {
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  proto.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
});
afterEach(() => { document.body.innerHTML = ""; });

describe("confirmAction", () => {
  it("answers yes only when the confirm button is pressed, and removes itself", async () => {
    const answer = confirmAction("Turn on emails?\n\nCustomers will be emailed.", { confirmLabel: "Yes, turn on" });
    const dialog = document.querySelector("dialog")!;
    expect(dialog.textContent).toContain("Customers will be emailed.");
    expect(dialog.getAttribute("aria-labelledby")).toBe("confirm-action-title");
    (Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Yes, turn on") as HTMLButtonElement).click();
    expect(await answer).toBe(true);
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("answers no for Cancel and starts focus on the safe choice", async () => {
    const answer = confirmAction("Delete it?");
    const dialog = document.querySelector("dialog")!;
    expect(document.activeElement?.textContent).toBe("Cancel");
    (Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Cancel") as HTMLButtonElement).click();
    expect(await answer).toBe(false);
  });

  it("answers no when the outside backdrop is clicked", async () => {
    const answer = confirmAction("Sure?");
    document.querySelector("dialog")!.click();
    expect(await answer).toBe(false);
  });
});
