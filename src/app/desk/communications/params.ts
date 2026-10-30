import { z } from "zod";

// AR-4d (QUOTES-MESSAGES spec section 3): the Messages inbox URL state in
// plain words, with the legacy stored-code params mapped onto them so old
// links keep working. Unknown values fall back to defaults, never throw.
export type InboxStatusTab = "open" | "waiting" | "done";
export type InboxWho = "all" | "mine" | "unassigned";
export type InboxMatch = "known" | "unknown" | "several";

export type MessagesParams = {
  status: InboxStatusTab;
  who: InboxWho;
  match?: InboxMatch;
  cursor?: string;
};

const STATUS_TABS: Record<string, InboxStatusTab> = {
  open: "open",
  waiting: "waiting",
  done: "done",
  OPEN: "open",
  WAITING: "waiting",
  CLOSED: "done",
};
const MATCHES: Record<string, InboxMatch> = {
  known: "known",
  unknown: "unknown",
  several: "several",
  RESOLVED: "known",
  UNRESOLVED: "unknown",
  AMBIGUOUS: "several",
};
const WHOS: Record<string, InboxWho> = {
  all: "all",
  mine: "mine",
  unassigned: "unassigned",
};

const rawSchema = z.object({
  status: z.string().optional(),
  resolution: z.string().optional(),
  assignment: z.string().optional(),
  who: z.string().optional(),
  match: z.string().optional(),
  cursor: z.string().optional(),
});

export function parseMessagesParams(input: {
  [key: string]: string | string[] | undefined;
}): MessagesParams {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const parsed = rawSchema.parse({
    status: first(input.status),
    resolution: first(input.resolution),
    assignment: first(input.assignment),
    who: first(input.who),
    match: first(input.match),
    cursor: first(input.cursor),
  });
  return {
    status: STATUS_TABS[parsed.status ?? ""] ?? "open",
    who: WHOS[parsed.who ?? ""] ?? WHOS[parsed.assignment ?? ""] ?? "all",
    match: MATCHES[parsed.match ?? ""] ?? MATCHES[parsed.resolution ?? ""],
    cursor: parsed.cursor || undefined,
  };
}

export const STATUS_ENUM: Record<InboxStatusTab, "OPEN" | "WAITING" | "CLOSED"> = {
  open: "OPEN",
  waiting: "WAITING",
  done: "CLOSED",
};
export const MATCH_ENUM: Record<InboxMatch, "RESOLVED" | "UNRESOLVED" | "AMBIGUOUS"> = {
  known: "RESOLVED",
  unknown: "UNRESOLVED",
  several: "AMBIGUOUS",
};

export function messagesHref(
  base: MessagesParams,
  patch: Partial<MessagesParams>,
): string {
  const next = { ...base, ...patch };
  const params = new URLSearchParams();
  params.set("status", next.status);
  if (next.who && next.who !== "all") params.set("who", next.who);
  if (next.match) params.set("match", next.match);
  if (next.cursor) params.set("cursor", next.cursor);
  return `/desk/communications?${params.toString()}`;
}
