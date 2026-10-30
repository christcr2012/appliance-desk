"use client";

import { ListSkeleton, RecordSkeleton, useKitWords } from "@/components/kit";

/**
 * PORTAL-1 section 6: every portal page's loading state is a kit
 * skeleton whose spoken label is the kit loading word in the
 * customer's language (the shell's KitWordsProvider carries the
 * portal's Spanish kit words). Each route's loading.tsx renders this.
 */
export function PortalLoading({ variant = "list" }: { variant?: "list" | "record" }) {
  const words = useKitWords();
  return variant === "record" ? (
    <RecordSkeleton label={words.loading} />
  ) : (
    <ListSkeleton label={words.loading} />
  );
}
