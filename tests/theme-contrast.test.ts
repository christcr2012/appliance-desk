import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");

function tokenBlock(selector: string): Record<string, string> {
  const marker = selector + " {";
  const start = css.indexOf(marker);
  if (start < 0) throw new Error("Missing CSS token block: " + selector);
  const end = css.indexOf("\n}", start);
  if (end < 0) throw new Error("Unclosed CSS token block: " + selector);
  const body = css.slice(start + marker.length, end);
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    tokens[match[1]] = match[2].toLowerCase();
  }
  return tokens;
}

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const clean = hex.slice(1);
  const red = parseInt(clean.slice(0, 2), 16);
  const green = parseInt(clean.slice(2, 4), 16);
  const blue = parseInt(clean.slice(4, 6), 16);
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("Evergreen semantic token contrast", () => {
  const light = tokenBlock(":root");
  const dark = tokenBlock(".dark");

  const pairs: Array<[string, string, string]> = [
    ["light ink on ivory", light["color-ink"], light["color-canvas"]],
    ["light muted on ivory", light["color-ink-soft"], light["color-canvas"]],
    ["light muted on white", light["color-ink-soft"], light["color-surface"]],
    ["evergreen on fresh", light["color-on-accent"], light["color-accent"]],
    ["white on evergreen", light["color-on-primary"], light["color-primary"]],
    ["dark ivory on night", dark["color-ink"], dark["color-canvas"]],
    ["dark muted on surface", dark["color-ink-soft"], dark["color-surface"]],
    ["dark success on surface", dark["color-success"], dark["color-surface"]],
    ["dark danger on surface", dark["color-danger"], dark["color-surface"]],
    ["dark warning on surface", dark["color-warning-ink"], dark["color-surface"]],
    ["dark warning on warning background", dark["color-warning-ink"], dark["color-warning-bg"]],
    ["dark primary button text", dark["color-on-primary"], dark["color-primary"]],
    ["dark accent button text", dark["color-on-accent"], dark["color-accent"]],
  ];

  it.each(pairs)("%s meets WCAG AA text contrast", (_label, foreground, background) => {
    expect(foreground).toMatch(/^#[0-9a-f]{6}$/);
    expect(background).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});

// V-1: the signature layer (type scale, hairline and tint colours, one raised shadow, cut shapes, the highlight) sits on
// top of these same colours. The tint is a mix computed in the browser, so the test computes the same mix.
function mixSrgb(a: string, b: string, percentOfA: number): string {
  const part = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16);
  const channelMix = (at: number) => Math.round((part(a, at) * percentOfA + part(b, at) * (100 - percentOfA)) / 100).toString(16).padStart(2, "0");
  return `#${channelMix(1)}${channelMix(3)}${channelMix(5)}`;
}

describe("V-1 signature layer", () => {
  const light = tokenBlock(":root");
  const dark = tokenBlock(".dark");
  const lightTint = mixSrgb(light["color-canvas-alt"], light["color-canvas"], 60);
  const darkTint = mixSrgb(dark["color-canvas-alt"], dark["color-canvas"], 60);

  const pairs: Array<[string, string, string]> = [
    ["light ink on the offset tint panel", light["color-ink"], lightTint],
    ["light muted on the offset tint panel", light["color-ink-soft"], lightTint],
    ["dark ivory on the offset tint panel", dark["color-ink"], darkTint],
    ["dark muted on the offset tint panel", dark["color-ink-soft"], darkTint],
    ["evergreen text on the fresh highlight (light)", light["color-on-accent"], light["color-accent"]],
    ["evergreen text on the fresh highlight (dark)", dark["color-on-accent"], dark["color-accent"]],
    ["white on the evergreen band", light["color-on-primary"], light["color-primary"]],
    ["dark ivory on the dark band surface", dark["color-ink"], dark["color-surface"]],
    ["light ink on the sage section", light["color-ink"], light["color-canvas-alt"]],
    ["light muted on the sage section", light["color-ink-soft"], light["color-canvas-alt"]],
  ];
  it.each(pairs)("%s meets WCAG AA text contrast", (_label, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the brand palette exactly as the kit defines it", () => {
    expect(light["color-primary"]).toBe("#123c2d");
    expect(light["color-accent"]).toBe("#b9e66b");
    expect(light["color-canvas"]).toBe("#f7f5ec");
    expect(light["color-canvas-alt"]).toBe("#dce7df");
    expect(dark["color-surface"]).toBe(dark["color-canvas-alt"]);
  });

  it("defines the whole signature set once, for light and dark", () => {
    for (const role of ["display", "h2", "h3", "lede", "eyebrow", "price"]) expect(css, role).toContain(`--text-${role}:`);
    expect(css).toContain("--color-hairline:");
    expect(css).toContain("--color-tint:");
    expect(css.match(/--shadow-raise:/g)?.length).toBe(3);
    for (const utility of ["cut-corner-sm", "cut-corner-md", "cut-corner-photo", "cut-band", "highlight"]) expect(css, utility).toContain(`@utility ${utility}`);
  });

  it("never lets a clip hide the keyboard focus ring", () => {
    for (const utility of ["cut-corner-sm", "cut-corner-md", "cut-corner-photo", "cut-band"]) {
      const start = css.indexOf(`@utility ${utility}`);
      const block = css.slice(start, css.indexOf("\n}\n", start));
      expect(block, utility).toContain("focus-visible");
      expect(block, utility).toContain("clip-path: none");
    }
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });
});
