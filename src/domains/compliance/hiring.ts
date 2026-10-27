import { businessDateKey } from "@/lib/business-date";
import { obligationByKey } from "./registry";

/**
 * CMP-5: the hiring checklist shown on the Compliance screen once the
 * business has employees. Every item's state derives from the business
 * facts or a filing — the checklist stores nothing of its own, so it can
 * never claim something is done that is not. Dates come from the first
 * employee's recorded start date; nothing is guessed.
 */

export interface HiringChecklistItem {
  key: string;
  title: string;
  what: string;
  /** "done" = derived complete; "todo" = still needs doing; "info" = standing guidance. */
  state: "done" | "todo" | "info";
  dueText?: string;
  links: { label: string; url: string }[];
}

export interface HiringChecklistInput {
  employees: number;
  hasEin: boolean;
  firstHireDate: Date | null;
  /** The co.payroll.new_hire filing for the first hire, when sync has created it. */
  newHireFiling: { state: string; dueOn: Date } | null;
}

const fmtDay = (d: Date) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);

/**
 * The new-hire filing that belongs to the CURRENT first start date.
 * Correcting the date retires the old filing (NOT_APPLICABLE) and sync
 * creates a replacement — matching on periodKey (the start date itself)
 * keeps the checklist from ever reading the retired filing's state or
 * deadline.
 */
export function selectNewHireFiling<T extends { obligationKey: string; periodKey: string; state: string; dueOn: Date }>(
  filings: T[],
  firstHireDate: Date | null,
): { state: string; dueOn: Date } | null {
  if (!firstHireDate) return null;
  const hireKey = businessDateKey(firstHireDate);
  return filings.find((f) => f.obligationKey === "co.payroll.new_hire" && f.periodKey === hireKey) ?? null;
}

/**
 * An obligation's researched figures, reused as checklist guidance so a
 * number lives in exactly one place (the registry entry, with its year
 * attached and its official source one tap away) instead of being
 * copied into a second string that can drift.
 */
function registryGuidance(key: string): string {
  const explain = obligationByKey(key)?.explain ?? "";
  return explain.replace(/ Dormant until you hire\.$/, ".");
}

const DONE_FILING_STATES = ["SUBMITTED", "ACCEPTED", "DONE_ELSEWHERE", "NOT_APPLICABLE"];

/** The checklist, or null while the business has no employees (it stays hidden). */
export function hiringChecklist(input: HiringChecklistInput): HiringChecklistItem[] | null {
  if (input.employees <= 0) return null;
  const source = (key: string) => {
    const obligation = obligationByKey(key);
    return obligation ? [{ label: obligation.agency, url: obligation.sourceUrl }] : [];
  };
  const newHireDue = input.newHireFiling ? fmtDay(input.newHireFiling.dueOn) : null;

  return [
    {
      key: "ein",
      title: "Employer Identification Number (EIN)",
      what: input.hasEin
        ? "Your EIN is on file (only the last 4 digits are ever shown). Payroll filings use it."
        : "You need an EIN before running payroll or filing payroll taxes. If the business has one, add it in Business facts — it is stored encrypted.",
      state: input.hasEin ? "done" : "todo",
      links: [{ label: "Business facts", url: "/desk/compliance/facts" }],
    },
    {
      key: "w4",
      title: "Form W-4 from each employee",
      what: "Each employee fills in a W-4 on or before their first day so withholding is right. Keep the signed form with the employee's records — it is not sent to the IRS.",
      state: "info",
      links: [{ label: "IRS — Form W-4", url: "https://www.irs.gov/forms-pubs/about-form-w-4" }],
    },
    {
      key: "i9",
      title: "Form I-9 for each employee",
      what: "The employee completes Section 1 on day 1; you examine their documents and complete Section 2 within 3 business days of the start date. Keep the form — it is not filed anywhere.",
      state: "info",
      links: [{ label: "USCIS — Form I-9", url: "https://www.uscis.gov/i-9" }],
    },
    {
      key: "new_hire",
      title: "Report the new hire to Colorado",
      what: "Colorado employers report each new hire to the State Directory of New Hires within 20 days of the start date. Your payroll service usually files this — confirm it did.",
      state: input.newHireFiling
        ? DONE_FILING_STATES.includes(input.newHireFiling.state)
          ? "done"
          : "todo"
        : "todo",
      dueText: input.firstHireDate
        ? newHireDue
          ? `Due ${newHireDue} (20 days after the ${fmtDay(input.firstHireDate)} start)`
          : `Due 20 days after the ${fmtDay(input.firstHireDate)} start`
        : "Due 20 days after the first employee's start date — add the date in Business facts so this deadline is scheduled",
      links: source("co.payroll.new_hire"),
    },
    {
      key: "co_withholding",
      title: "Colorado wage withholding account",
      what: "Open a wage withholding account with the Department of Revenue (Revenue Online) so state tax taken out of pay has somewhere to go. Your payroll service needs the account number.",
      state: "info",
      links: source("co.payroll.withholding"),
    },
    {
      key: "ui_account",
      title: "Colorado unemployment insurance account",
      what: `Register as an employer with the Department of Labor and Employment (MyUI Employer+). ${registryGuidance("co.payroll.ui")}`,
      state: "info",
      links: source("co.payroll.ui"),
    },
    {
      key: "famli",
      title: "Register for Colorado FAMLI",
      what: `Register in My FAMLI+ Employer before your first payroll. ${registryGuidance("co.payroll.famli")}`,
      state: "info",
      links: source("co.payroll.famli"),
    },
    {
      key: "workers_comp",
      title: "Workers' compensation insurance",
      what: "Colorado requires workers' comp coverage as soon as you have an employee. Keep the policy in Business records so it is on hand for audits and renewals.",
      state: "info",
      links: [{ label: "Business records", url: "/desk/records" }],
    },
    {
      key: "posters",
      title: "Workplace posters",
      what: "Put up the required federal and Colorado workplace posters where employees can see them. The official downloads are free — never pay a poster service for them.",
      state: "info",
      links: [
        { label: "U.S. Department of Labor posters", url: "https://www.dol.gov/agencies/whd/posters" },
        {
          label: "Colorado new employer checklist",
          url: "https://cdle.colorado.gov/employers/recruiting-hiring/new-employer-checklist",
        },
      ],
    },
    {
      key: "sick_leave",
      title: "Paid sick leave tracking",
      what: "Under Colorado's Healthy Families and Workplaces Act, employees earn 1 hour of paid sick leave for every 30 hours worked, up to 48 hours a year. Make sure your payroll service has accrual switched on from day 1.",
      state: "info",
      dueText: input.firstHireDate
        ? `Accrual starts on the first day of work (${fmtDay(input.firstHireDate)})`
        : undefined,
      links: [],
    },
  ];
}

/** One line for the checklist header: which hire the dates hang off. */
export function hiringSummary(input: HiringChecklistInput): string {
  const who = input.employees === 1 ? "1 employee" : `${input.employees} employees`;
  return input.firstHireDate
    ? `${who} · first start date ${businessDateKey(input.firstHireDate)}`
    : `${who} · no start date recorded yet`;
}
