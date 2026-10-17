import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { PreviewBridge } from "@/components/site/preview-bridge";
import { SITE_KEYS, markText } from "@/domains/site-content/preview-markers";

afterEach(cleanup);

describe("the select-to-edit script in the owner's preview", () => {
  it("removes every mark from words and attributes, and reports a click on marked words to this website only", () => {
    const post = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    const parentPost = vi.fn();
    Object.defineProperty(window, "parent", { value: { postMessage: parentPost }, configurable: true });
    const intro = markText("how.intro", "Hello visitors");
    const view = render(
      <div>
        <p data-testid="p">{intro}</p>
        <button aria-label={markText("header.cta.live", "Get a quote")} data-testid="b">Quote</button>
        <PreviewBridge keys={SITE_KEYS} revisionId="rev12345" />
      </div>,
    );
    expect(view.getByTestId("p").textContent).toBe("Hello visitors");
    expect(view.getByTestId("b").getAttribute("aria-label")).toBe("Get a quote");
    expect(document.body.textContent).not.toMatch(/[-]/);
    fireEvent.click(view.getByTestId("p"));
    expect(parentPost).toHaveBeenCalledWith({ type: "website-select", key: "how.intro", revision: "rev12345" }, window.location.origin);
    post.mockRestore();
  });
});
