import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Tokens = Record<string, string>;

function cssBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing ${selector} token block`).toBeGreaterThanOrEqual(0);
  const bodyStart = css.indexOf("{", start) + 1;
  const end = css.indexOf("}", bodyStart);
  return css.slice(bodyStart, end);
}

function tokensFrom(block: string): Tokens {
  const tokens: Tokens = {};
  for (const match of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6}|\d+px)\s*;/g)) {
    tokens[match[1]] = match[2].toLowerCase();
  }
  return tokens;
}

function luminance(hex: string): number {
  const channels = hex
    .replace("#", "")
    .match(/.{2}/g)!
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045
        ? value / 12.92
        : Math.pow((value + 0.055) / 1.055, 2.4),
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

const css = fs.readFileSync(
  path.join(process.cwd(), "src", "app", "globals.css"),
  "utf8",
);
const light = tokensFrom(cssBlock(css, ":root"));
const dark = { ...light, ...tokensFrom(cssBlock(css, ".dark")) };

const textPairs = [
  ["ink/canvas", "color-ink", "color-canvas"],
  ["ink/surface", "color-ink", "color-surface"],
  ["muted/canvas", "color-ink-soft", "color-canvas"],
  ["muted/surface", "color-ink-soft", "color-surface"],
  ["action", "color-on-action", "color-action"],
  ["navigation", "color-nav-ink", "color-nav-bg"],
  ["current navigation", "color-nav-current-ink", "color-nav-current-bg"],
  // AR-0 kit pills and rows (KIT section 1).
  ["good pill", "color-success", "color-success-soft"],
  ["info pill", "color-info-ink", "color-info-soft"],
  ["attention pill", "color-warning-ink", "color-warning-bg"],
  ["selected row text", "color-ink", "color-success-soft"],
  ["selected row muted text", "color-ink-soft", "color-success-soft"],
] as const;

const uiPairs = [
  ["control border/surface", "color-control", "color-surface"],
  ["focus/canvas", "color-focus-ring", "color-canvas"],
  ["focus/surface", "color-focus-ring", "color-surface"],
] as const;

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("E2 %s token contrast", (_mode, tokens) => {
  for (const [name, foreground, background] of textPairs) {
    it(`${name} is at least 4.5:1`, () => {
      expect(contrast(tokens[foreground], tokens[background])).toBeGreaterThanOrEqual(4.5);
    });
  }

  for (const [name, foreground, background] of uiPairs) {
    it(`${name} is at least 3:1`, () => {
      expect(contrast(tokens[foreground], tokens[background])).toBeGreaterThanOrEqual(3);
    });
  }
});

it("exports the approved brand-kit radii", () => {
  expect(light["radius-control"]).toBe("8px");
  expect(light["radius-card"]).toBe("16px");
  expect(light["radius-field"]).toBe("12px");
});

it("defines every AR-0 kit color in both light and dark blocks and maps it into @theme", () => {
  const darkOnly = tokensFrom(cssBlock(css, ".dark"));
  for (const token of ["color-success-soft", "color-info-soft", "color-info-ink"]) {
    expect(light[token], `light ${token}`).toMatch(/^#[0-9a-f]{6}$/);
    expect(darkOnly[token], `dark ${token}`).toMatch(/^#[0-9a-f]{6}$/);
    expect(css).toContain(`--${token}: var(--${token});`);
  }
  expect(css).toContain("--radius-field: var(--radius-field);");
});
