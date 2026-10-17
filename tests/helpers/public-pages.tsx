import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

// V-C3: renders a public route (with the shared header, footer and banner) to plain visible text so tests can prove
// what a visitor reads. Text is returned one line per element, in page order.

export const FIXTURE_SETTINGS = {
  publicBusinessName: "Fixture Rentals Co",
  publicPhone: "(970) 555-0142",
  publicEmail: "hello@fixture.example",
  publicAddress: "12 Fixture Way, Greeley, CO 80631",
  hours: { mon: { open: "09:00", close: "17:00" }, tue: { open: "09:00", close: "17:00" }, sat: { closed: true } } as unknown,
  holidayClosures: [{ date: "2099-12-25", label: "Christmas Day" }] as unknown,
  socialLinks: { facebook: "https://facebook.example/fixture" } as unknown,
  serviceAreaCities: ["Greeley", "Windsor"] as unknown,
  serviceAreaZips: ["80631", "80634"] as unknown,
  depositEnabled: true,
  damageWaiverEnabled: true,
  lateFeeGraceDays: 5,
  oneTimeDeliveryFeeCents: 2500,
  oneTimeInstallationFeeCents: 0,
  oneTimeRemovalFeeCents: 1500,
  legalApprovals: null as unknown,
} as Record<string, unknown>;

export const FIXTURE_CATALOG = [
  { kind: "type", id: "t1", slug: "washer", name: "Washer", monthlyPriceCents: 3500, photoUrl: null, contents: null, savingCents: null },
  { kind: "package", id: "p1", slug: "set", name: "Washer + Dryer Set", monthlyPriceCents: 6000, photoUrl: null, contents: "1 washer + 1 dryer", savingCents: 1000 },
];

function decode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;|&apos;/g, "'");
}

/** Visible text lines, plus alt text, links and form words, so a change to any of them shows. */
export function visibleLines(element: ReactElement): string[] {
  const html = renderToStaticMarkup(element);
  const noScripts = html.replace(/<!-- -->/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
  const lines: string[] = [];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(noScripts))) {
    if (m[4] !== undefined) {
      const text = decode(m[4]).replace(/\s+/g, " ").trim();
      if (text) lines.push(text);
    } else if (m[2] && !m[1] && m[2] !== "link") {
      const attrs = m[3];
      for (const name of ["alt", "aria-label", "placeholder", "title", "href", "label", ...(m[2] === "img" ? ["src"] : [])]) {
        const a = new RegExp(`\\s${name}="([^"]*)"`).exec(attrs);
        if (a && a[1] && !(name === "href" && a[1].startsWith("#"))) lines.push(`[${m[2]} ${name}] ${decode(a[1])}`);
      }
    }
  }
  return lines.map((l) => l.replace(/© \d{4}/, "© YEAR"));
}
