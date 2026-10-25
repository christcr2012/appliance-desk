import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const LIME = "#B9E66B";

describe("website logo files match the two-tone brand kit", () => {
  it.each([
    ["public/brand/logo-light.svg", "docs/brand/01_Logos/horizontal/Robinson-horizontal-light.svg"],
    ["public/brand/logo-dark.svg", "docs/brand/01_Logos/horizontal/Robinson-horizontal-dark.svg"],
    ["public/brand/mark.svg", "docs/brand/01_Logos/mark/Robinson-mark-light.svg"],
  ])("%s is an exact copy of %s", (web, kit) => {
    expect(read(web)).toBe(read(kit));
  });

  it.each(["public/brand/badge.svg", "src/app/icon.svg", "public/brand/logo-light.svg", "public/brand/logo-dark.svg"])(
    "%s keeps the lime-green leg",
    (file) => {
      expect(read(file).toUpperCase()).toContain(LIME);
    },
  );
});
