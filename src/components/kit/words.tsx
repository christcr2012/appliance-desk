"use client";

/**
 * Kit fixed words (PORTAL-1, PORTAL.md section 4). A few kit components
 * render their own short words; those words live here once, in English,
 * so a translated set can be provided around a subtree. Client
 * components read them with useKitWords(); the default is English, so
 * the desk needs no provider and renders exactly as before. Server
 * components (DataTable, NextStepCard) cannot read context — they take
 * the same words as optional props with these English defaults.
 */
import { createContext, useContext, type ReactNode } from "react";

export const KIT_WORDS_EN = {
  loadMore: "Load more",
  loading: "Loading…",
  cancel: "Cancel",
  undo: "Undo",
  nextStep: "Next step",
  narrowFilters: "Narrow your filters to see more",
  pageLoadFailed: "Something went wrong loading this page.",
  tryAgain: "Try again",
} as const;

export type KitWords = { [K in keyof typeof KIT_WORDS_EN]: string };

const KitWordsContext = createContext<KitWords>(KIT_WORDS_EN);

export function KitWordsProvider({
  words,
  children,
}: {
  words: KitWords;
  children: ReactNode;
}) {
  return (
    <KitWordsContext.Provider value={words}>{children}</KitWordsContext.Provider>
  );
}

export function useKitWords(): KitWords {
  return useContext(KitWordsContext);
}
