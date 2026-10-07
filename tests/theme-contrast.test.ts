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
