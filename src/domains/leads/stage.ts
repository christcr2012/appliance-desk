import type { LeadStatus, Prisma } from "@prisma/client";

/**
 * LD-1: the pipeline stage a lead is in. The stored `Lead.status` alone
 * cannot tell "New" from "Contacted" (a website lead used to be stamped
 * contacted at creation), so the stage is derived: a lead is New only while
 * nobody has really contacted it yet (`firstContactedAt` is null).
 *
 * First match wins: CONVERTED → won; LOST → lost; an open quote (an estimate
 * SENT or VIEWED) → quoted; NEW and never contacted → new; anything else →
 * contacted. Merged leads belong to no stage (every `leadStageWhere` below
 * excludes them); the function itself is only called on live leads.
 */
export type LeadStage = "new" | "contacted" | "quoted" | "won" | "lost";

export function leadStage(l: {
  status: LeadStatus;
  firstContactedAt: Date | null;
  openQuote: boolean;
}): LeadStage {
  if (l.status === "CONVERTED") return "won";
  if (l.status === "LOST") return "lost";
  if (l.openQuote) return "quoted";
  if (l.status === "NEW" && l.firstContactedAt === null) return "new";
  return "contacted";
}

/** The same rules as database filters, for list/count queries. */
export const leadStageWhere: Record<LeadStage, Prisma.LeadWhereInput> = {
  // A NEW lead with an open quote is "quoted", not "new": sending a quote
  // whose email never went out leaves the lead uncontacted but quoted.
  new: {
    status: "NEW",
    firstContactedAt: null,
    mergedIntoLeadId: null,
    estimates: { none: { status: { in: ["SENT", "VIEWED"] } } },
  },
  contacted: {
    status: { in: ["NEW", "CONTACTED"] },
    mergedIntoLeadId: null,
    NOT: [
      { status: "NEW", firstContactedAt: null },
      { estimates: { some: { status: { in: ["SENT", "VIEWED"] } } } },
    ],
  },
  quoted: {
    status: { in: ["NEW", "CONTACTED"] },
    mergedIntoLeadId: null,
    estimates: { some: { status: { in: ["SENT", "VIEWED"] } } },
  },
  won: { status: "CONVERTED", mergedIntoLeadId: null },
  lost: { status: "LOST", mergedIntoLeadId: null },
};
