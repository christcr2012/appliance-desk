import { notFound } from "next/navigation";
import { FeedbackError } from "@/domains/feedback";
import { NOT_FOUND } from "@/domains/feedback/rules";
import { appRevisionFrom, describeRouteTemplate, describeSafeContext, safeContextFrom, toRouteTemplate } from "@/domains/feedback/context";

/** The plain words in "What we'll also see" — exactly what the report will store, nothing more. */
export function contextSummaryFor(from: string | undefined, userAgent: string | null, language: string): string {
  const parts = [`Page: ${describeRouteTemplate(toRouteTemplate(from ?? "/"))}`];
  const revision = appRevisionFrom(process.env.VERCEL_GIT_COMMIT_SHA);
  if (revision) parts.push(`App version ${revision}`);
  parts.push(describeSafeContext(safeContextFrom(userAgent, language)));
  return parts.join(" · ");
}

/** A report that is not the person's own looks exactly like one that does not exist. */
export async function orNotFound<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof FeedbackError && error.message === NOT_FOUND) notFound();
    throw error;
  }
}

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
