import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ActionButton } from "@/components/kit";
import { OfflineBar } from "@/components/kit/offline-bar";

vi.mock("next/navigation", () => import("./kit-test-env"));
afterEach(() => { cleanup(); delete document.body.dataset.offline; vi.restoreAllMocks(); });

describe("AR-11 offline status", () => {
  it("hides its banner when online and disables kit writes when offline", async () => {
    let online = true;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    const action = vi.fn(async () => undefined);
    render(<><OfflineBar /><ActionButton spec={{ kind: "form", label: "Save changes", action }} /></>);
    expect(screen.queryByText("You're offline — changes are paused")).toBeNull();
    online = false;
    await act(async () => fireEvent(window, new Event("offline")));
    await waitFor(() => expect(document.body).toHaveAttribute("data-offline", "true"));
    const button = screen.getByRole("button", { name: "Save changes" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "You're offline");
    await act(async () => fireEvent.click(button));
    expect(action).not.toHaveBeenCalled();
    online = true;
    await act(async () => fireEvent(window, new Event("online")));
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(document.body).not.toHaveAttribute("data-offline");
  });
});
