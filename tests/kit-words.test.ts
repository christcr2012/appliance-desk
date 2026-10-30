import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  KIT_WORDS_EN,
  KitWordsProvider,
  useKitWords,
} from "../src/components/kit/words";
import {
  PORTAL_TRANSLATIONS,
  portalKitWords,
} from "../src/domains/language/portal-copy";

function Probe() {
  const words = useKitWords();
  return createElement(
    "span",
    null,
    [words.loadMore, words.loading, words.cancel, words.undo, words.nextStep].join("|"),
  );
}

describe("kit words", () => {
  it("defaults to English with no provider (the desk is unchanged)", () => {
    const html = renderToString(createElement(Probe));
    expect(html).toContain("Load more|Loading…|Cancel|Undo|Next step");
  });

  it("serves the provided words inside a provider", () => {
    const html = renderToString(
      createElement(
        KitWordsProvider,
        { words: portalKitWords("es") },
        createElement(Probe),
      ),
    );
    expect(html).toContain("Cargar más|Cargando…|Cancelar|Deshacer|Siguiente paso");
  });

  it("portalKitWords('en') is exactly the English kit words", () => {
    expect(portalKitWords("en")).toEqual(KIT_WORDS_EN);
  });

  it("every kit word has a portal Spanish translation", () => {
    for (const english of Object.values(KIT_WORDS_EN)) {
      expect(
        PORTAL_TRANSLATIONS[english as keyof typeof PORTAL_TRANSLATIONS],
        `missing Spanish for "${english}"`,
      ).toBeTruthy();
    }
    const spanish = portalKitWords("es");
    for (const [key, value] of Object.entries(spanish)) {
      expect(value, `empty Spanish kit word ${key}`).not.toBe("");
      expect(value).not.toBe(KIT_WORDS_EN[key as keyof typeof KIT_WORDS_EN]);
    }
  });
});
