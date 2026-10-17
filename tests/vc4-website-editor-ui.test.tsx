import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  save: vi.fn(),
  publish: vi.fn(),
  restore: vi.fn(),
  discard: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: vi.fn() }), usePathname: () => "/desk/settings/website" }));
vi.mock("@/app/desk/settings/website/actions", () => ({
  saveWebsiteValuesAction: mocks.save,
  publishWebsiteAction: mocks.publish,
  restoreToDraftAction: mocks.restore,
  discardDraftAction: mocks.discard,
}));

import { editorFields } from "@/domains/site-content/editor-fields";
import { siteDefaultTypedValues } from "@/domains/site-content/fields";
import { WEBSITE_PAGES } from "@/domains/site-content/pages";
import { WebsiteWorkspace } from "@/app/desk/settings/website/workspace";
import { ReviewPanel } from "@/app/desk/settings/website/review-panel";
import { HistoryPanel } from "@/app/desk/settings/website/history-panel";
import { diffValues, pagesAffected } from "@/domains/site-content/review";
import type { SiteValue } from "@/domains/site-content/types";

const nowIso = "2026-10-17T15:00:00.000Z";
const pages = WEBSITE_PAGES.map((p) => ({ id: p.id, name: p.name, about: p.about, previewPath: p.previewPath, beforeOpeningOnly: p.beforeOpeningOnly === true, note: null }));
const defaults = siteDefaultTypedValues();

async function problems(container: HTMLElement) {
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(" | ")}`);
}

function workspace(over: Partial<React.ComponentProps<typeof WebsiteWorkspace>> = {}) {
  return (
    <WebsiteWorkspace
      pages={pages}
      fields={editorFields()}
      defaults={defaults}
      liveStored={{}}
      startValues={{}}
      draft={null}
      liveRevisionId="live1234"
      assets={[{ id: "asset0001", state: "PUBLIC", width: 800, height: 600, previewPath: "/api/desk/site-media/asset0001" }]}
      facts={{ phone: "970-555-0100", businessName: "Test Rentals" }}
      nowIso={nowIso}
      {...over}
    />
  );
}

beforeEach(() => { Object.values(mocks).forEach((m) => m.mockReset()); });
afterEach(cleanup);

describe("Website editor screen", () => {
  it("is free of automated accessibility problems for words, a link, a picture and a promotion", async () => {
    for (const key of ["how.intro", "header.cta.live", "home.hero.image", "site.banner.promotion"]) {
      const view = render(workspace({ initialKey: key }));
      expect(await problems(view.container), key).toEqual([]);
      view.unmount();
    }
  });

  it("shows where an item appears, what is live, a counter and the business facts it can use", () => {
    render(workspace({ initialKey: "how.intro" }));
    expect(screen.getByText(/Appears on:/)).toBeInTheDocument();
    expect(screen.getByText("Live now")).toBeInTheDocument();
    expect(screen.getByText(/characters$/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Introduction" })).toBeInTheDocument();
  });

  it("keeps what was typed when a save fails, says so, and does not claim it was saved", async () => {
    mocks.save.mockResolvedValueOnce({ status: "error", message: "Introduction is too long: 2000 characters at most." });
    render(workspace({ initialKey: "how.intro" }));
    const box = screen.getByRole("textbox", { name: "Introduction" });
    fireEvent.change(box, { target: { value: "My new words" } });
    expect(screen.getByText("You have changes that are not saved.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("too long");
    expect(screen.getByRole("textbox", { name: "Introduction" })).toHaveValue("My new words");
    expect(screen.queryByText(/Draft saved/)).toBeNull();
  });

  it("saves once when Save is pressed twice quickly, then reports the draft honestly", async () => {
    let finish: (v: unknown) => void = () => undefined;
    mocks.save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(workspace({ initialKey: "how.intro" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Introduction" }), { target: { value: "Words" } });
    const save = screen.getByRole("button", { name: "Save draft" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ values: { "how.intro": { kind: "text", text: "Words" } } });
    await act(async () => finish({ status: "saved", draftId: "draft123", version: 4 }));
    expect(await screen.findByText(/Draft saved\. Visitors still see the live website\./)).toBeInTheDocument();
    expect(screen.getByText(/Draft saved \(1 change from the live website\)\./)).toBeInTheDocument();
  });

  it("puts words back to the starting wording with Restore recommended, and sends nothing for an unchanged item", async () => {
    mocks.save.mockResolvedValue({ status: "saved", draftId: "d", version: 2 });
    render(workspace({ initialKey: "how.intro", startValues: { "how.intro": { kind: "text", text: "Changed" } }, draft: { id: "d1", version: 1 } }));
    fireEvent.click(screen.getByRole("button", { name: "Restore recommended" }));
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0][0].values).toEqual({});
  });

  it("opens the item the preview reports, but only for this website's own message about this version", async () => {
    render(workspace({ initialPageId: "how", draft: { id: "draftver1", version: 2 }, startValues: {} }));
    const fire = (data: unknown, origin = window.location.origin) => act(() => { window.dispatchEvent(new MessageEvent("message", { data, origin })); });
    fire({ type: "website-select", key: "how.intro", revision: "someoneelse" });
    expect(screen.queryByRole("textbox", { name: "Introduction" })).toBeNull();
    fire({ type: "website-select", key: "how.intro", revision: "draftver1" }, "https://evil.example");
    expect(screen.queryByRole("textbox", { name: "Introduction" })).toBeNull();
    fire({ type: "website-select", key: "not.a.key", revision: "draftver1" });
    expect(screen.queryByRole("textbox", { name: "Introduction" })).toBeNull();
    fire({ type: "website-select", key: "how.intro", revision: "draftver1" });
    expect(await screen.findByRole("textbox", { name: "Introduction" })).toBeInTheDocument();
  });

  it("finds an item by a word in its name and opens it", () => {
    render(workspace());
    fireEvent.change(screen.getByLabelText(/Search for words/), { target: { value: "introduction" } });
    const results = screen.getByRole("list", { name: "Search results" });
    fireEvent.click(within(results).getAllByRole("button")[0]);
    expect(screen.getByText(/Appears on:/)).toBeInTheDocument();
  });

  it("uses the Colorado time boxes and tells the owner whether a promotion is visible now", () => {
    render(workspace({ initialKey: "site.banner.promotion", startValues: { "site.banner.promotion": { kind: "promotion", title: "Sale", body: "", enabled: true, startsAtUtc: "2026-11-01T06:00:00.000Z" } } }));
    expect(screen.getByRole("status")).toHaveTextContent(/Not visible yet/);
    expect(screen.getByLabelText("Starts on")).toHaveValue("2026-11-01");
    expect(screen.getByLabelText("Starts at")).toHaveValue("00:00");
  });
});

describe("Review and publish screen", () => {
  const live = { ...defaults };
  const draft: Record<string, SiteValue> = { ...defaults, "how.intro": { kind: "text", text: "Brand new intro" } };
  const changes = diffValues(live, draft);
  const review = { draft: { id: "draft1", version: 3 }, liveRevisionId: "live1", changes, pages: pagesAffected(changes), facts: [], problems: [] as string[] };

  it("shows before and after, passes the accessibility scan and publishes with both versions", async () => {
    mocks.publish.mockResolvedValueOnce({ status: "published", version: 3, alreadyLive: false });
    const view = render(<ReviewPanel review={review} nowIso={nowIso} pagePaths={{ how: "/how-it-works" }} />);
    expect(await problems(view.container)).toEqual([]);
    expect(screen.getByText(/Brand new intro/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Publish 1 change to the live website" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(mocks.publish).toHaveBeenCalledWith({ draftId: "draft1", version: 3, liveRevisionId: "live1" });
    expect(await screen.findByText(/now live as version 3/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /How it works \(opens in a new tab\)/ })).toHaveAttribute("href", "/how-it-works");
  });

  it("blocks publishing when something needs fixing and explains a refused publish without saying it worked", async () => {
    const { unmount } = render(<ReviewPanel review={{ ...review, problems: ['The picture for "Hero" was removed.'] }} nowIso={nowIso} pagePaths={{}} />);
    expect(screen.getByRole("button", { name: /^Publish/ })).toBeDisabled();
    unmount();
    mocks.publish.mockResolvedValueOnce({ status: "error", message: "The live website changed after you started reviewing.", stale: true });
    render(<ReviewPanel review={review} nowIso={nowIso} pagePaths={{}} />);
    fireEvent.click(screen.getByRole("button", { name: /^Publish/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("live website changed");
    expect(screen.getByRole("button", { name: "Reload and review again" })).toBeInTheDocument();
    expect(screen.queryByText(/now live/)).toBeNull();
  });
});

describe("History screen", () => {
  const rows = [
    { id: "r3", version: 3, live: true, when: "Oct 17 · 9:00 AM", by: "Chris", note: null },
    { id: "r2", version: 2, live: false, when: "Oct 16 · 9:00 AM", by: "Chris", note: "Older" },
  ];
  it("restores into the draft, never live, and warns before replacing an open draft", async () => {
    mocks.restore.mockResolvedValue({ status: "restored", draftId: "d9", version: 9, replacedDraft: true });
    const view = render(<HistoryPanel rows={rows} draft={{ id: "d1", version: 1, changes: 2 }} />);
    expect(await problems(view.container)).toEqual([]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "Put in draft" }));
    expect(confirm.mock.calls[0][0]).toMatch(/replaces your unpublished draft/);
    expect(mocks.restore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Put in draft" }));
    await screen.findByText(/It is not live/);
    expect(mocks.restore).toHaveBeenCalledWith({ revisionId: "r2", draftId: "d1", draftVersion: 1 });
    expect(screen.queryByRole("button", { name: "Put in draft" })).not.toBeNull();
  });
  it("discards the draft only after confirmation", async () => {
    mocks.discard.mockResolvedValue({ status: "discarded" });
    render(<HistoryPanel rows={rows} draft={{ id: "d1", version: 1, changes: 2 }} />);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "Discard the draft" }));
    expect(mocks.discard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard the draft" }));
    await screen.findByText(/draft was discarded/);
    expect(mocks.discard).toHaveBeenCalledWith({ draftId: "d1", version: 1 });
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
