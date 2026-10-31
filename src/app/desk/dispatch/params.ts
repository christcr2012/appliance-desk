import { z } from "zod";

// AR-5 section 3: the Board's URL state. Unknown values fall back to defaults, never throw.
// view: day | week | agenda; date: a Denver calendar day (YYYY-MM-DD); who: everyone | mine |
// unassigned | a team member id (OWNER/ADMIN only — the domain ignores it for STAFF);
// open: the visit id shown in the desktop side panel.
const rawSchema = z.object({
  view: z.string().optional(),
  date: z.string().optional(),
  who: z.string().optional(),
  open: z.string().optional(),
});

export type BoardView = "day" | "week" | "agenda";

export type BoardParams = {
  view: BoardView;
  /** YYYY-MM-DD (Denver). Undefined means today. */
  date?: string;
  who?: string;
  open?: string;
};

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export function parseBoardParams(input: {
  [key: string]: string | string[] | undefined;
}): BoardParams {
  const raw = rawSchema.parse(input);
  const view: BoardView =
    raw.view === "week" || raw.view === "agenda" ? raw.view : "day";
  let date: string | undefined;
  if (raw.date && DATE_SHAPE.test(raw.date)) {
    const parsed = new Date(`${raw.date}T12:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw.date) {
      date = raw.date;
    }
  }
  return {
    view,
    date,
    who: raw.who?.trim() ? raw.who.trim() : undefined,
    open: raw.open?.trim() ? raw.open.trim() : undefined,
  };
}
