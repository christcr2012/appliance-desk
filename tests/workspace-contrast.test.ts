import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const css = readFileSync("src/app/globals.css", "utf8");
function luminance(hex: string) {
  const rgb = hex
    .match(/[a-f\d]{2}/gi)!
    .map((c) => parseInt(c, 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
it.each([":root", ".dark"])(
  "checks actual semantic tokens in %s",
  (selector) => {
    const block = css.slice(css.indexOf(`${selector} {`)).split("}")[0];
    const token = (name: string) =>
      block.match(new RegExp(`--color-${name}: (#[a-fA-F0-9]{6})`))![1];
    expect(
      contrast(token("action"), token("on-action")),
    ).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("ink-soft"), token("subtle"))).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrast(token("control"), token("surface"))).toBeGreaterThanOrEqual(
      3,
    );
  },
);
