// AR-0b: how Today's inbox groups, orders, labels and acts on To do items (docs/build-specs/screens/TODAY.md section 3).
// Pure: no database reads. The customer record uses the same `inboxActions`, so buttons are identical everywhere.
import type { ActionSpec, FormAction, MenuItem, Tone } from "@/components/kit/types";
import type { ExceptionCategory, ExceptionItem } from "./rules";
import { todoAction, todoDeadlineLabel } from "./todo";

export type InboxGroup = "money" | "sales" | "rentals" | "equipment" | "taxes" | "tasks" | "system";

/** Every category in exactly one group. A category added later fails the build here until it is placed. */
export const INBOX_GROUP: Record<ExceptionCategory, InboxGroup> = {
  BOOKS_NOT_UP_TO_DATE: "taxes",
  BOOKS_NEEDS_FIX: "taxes",
  BOOKS_SETUP: "taxes",
  BOOKS_MONTH_REVIEW: "taxes",
  PAST_DUE_INVOICE: "money",
  BANK_PAYMENT_SLOW: "money",
  PAYMENT_DISPUTE: "money",
  COLLECTION_STEP: "money",
  CONTINUITY: "system",
  PRIVACY_DUTY: "system",
  LATE_FEE_REVIEW: "money",
  DECISIONS_STARTING_VALUES: "taxes",
  HELD_PAYMENT_DECISION: "money",
  DEPOSIT_DECISION: "money",
  CANCELLATION_REFUND_DUE: "money",
  SIGNING_PAYMENT_DUE: "money",
  BILLING_BLOCKED: "money",
  SUBSCRIPTION_UPDATE_PENDING: "money",
  APPROVAL_REQUEST: "money",
  COMPLIANCE_DUE: "money",
  NEW_LEAD_CONTACT: "sales",
  LEAD_FOLLOW_UP: "sales",
  APPROVED_QUOTE: "sales",
  UNSIGNED_AGREEMENT: "sales",
  STALE_RESERVATION: "sales",
  GOAL_BEHIND: "sales",
  SIGNED_DELIVERY_UNSCHEDULED: "rentals",
  RENTAL_ENDING_SOON: "rentals",
  PICKUP_UNSCHEDULED: "rentals",
  VISIT_NEEDS_ASSIGNMENT: "rentals",
  OVERDUE_JOB: "rentals",
  UNREVIEWED_MAINTENANCE_REQUEST: "rentals",
  AGREEMENT_TERM_EXPIRED: "rentals",
  RENEWAL_NOT_STARTED: "rentals",
  EARLY_ENDING_NOT_DONE: "rentals",
  ITEM_NOT_DELIVERED: "rentals",
  RETURNED_EARLY: "rentals",
  NOTICE_WAITING: "rentals",
  NOTICE_MISSED: "rentals",
  NOTICE_UNCERTAIN: "rentals",
  NOTICE_FAILED: "rentals",
  CLEANING_NEEDED: "equipment",
  UNINSPECTED_RETURN: "equipment",
  MISSING_REPAIR_COST: "equipment",
  APPLIANCE_MAINTENANCE_DUE: "equipment",
  OLD_SET_APPLIANCE: "equipment",
  OUT_OF_SERVICE: "equipment",
  CUSTODY_UNKNOWN: "equipment",
  IDLE_APPLIANCES: "equipment",
  LOW_UTILIZATION: "equipment",
  RETIRED_APPLIANCE_PLAN: "equipment",
  RECALL_POSSIBLE: "equipment",
  SAFETY_INCIDENT: "equipment",
  RETIRED_SALE_TAX_REVIEW: "equipment",
  SALES_TAX: "taxes",
  TAX_RETURN_DUE: "taxes",
  TAX_LICENSE_RENEWAL: "taxes",
  TAX_SETUP_CHECK: "taxes",
  TAX_AMENDMENT_DUE: "taxes",
  TAX_FILING_NOT_READY: "taxes",
  ACQUISITION_TAX_REVIEW: "taxes",
  PURCHASE_USE_TAX_DUE: "taxes",
  RETAIL_DELIVERY_FEE: "taxes",
  BUSINESS_PAPERWORK: "taxes",
  SYSTEM_ISSUE: "system",
  // Not in the TODAY.md list (added by MCP-10a after the spec): app feedback to read sits with system notices.
  FEEDBACK_WAITING: "system",
};

export const INBOX_GROUP_ORDER: readonly InboxGroup[] = ["money", "sales", "rentals", "equipment", "taxes", "tasks", "system"];

export const INBOX_GROUP_LABEL: Record<InboxGroup, string> = {
  money: "Money",
  sales: "Sales",
  rentals: "Rentals & visits",
  equipment: "Equipment",
  taxes: "Taxes & books",
  tasks: "Tasks",
  system: "System",
};

/** High first, then the nearest deadline (no deadline last), then whatever has waited longest. */
export function sortInbox(items: ExceptionItem[]): ExceptionItem[] {
  const due = (item: ExceptionItem) => (item.dueOn && Number.isFinite(item.dueOn.getTime()) ? item.dueOn.getTime() : Infinity);
  return [...items].sort(
    (a, b) =>
      (a.severity === "high" ? 0 : 1) - (b.severity === "high" ? 0 : 1) ||
      due(a) - due(b) ||
      a.since.getTime() - b.since.getTime(),
  );
}

export function inboxEyebrow(item: ExceptionItem, now: Date): string {
  const deadline = todoDeadlineLabel(item.dueOn, now, item.dueDateOnly);
  return [item.severity === "high" ? "Urgent" : null, INBOX_GROUP_LABEL[INBOX_GROUP[item.category]], deadline]
    .filter(Boolean)
    .join(" · ");
}

export function inboxEyebrowTone(item: ExceptionItem): Tone {
  if (item.severity === "high") return "attention";
  return INBOX_GROUP[item.category] === "sales" ? "info" : "neutral";
}

/** The page's existing server actions for the three tax items that are answered right on Today (owner only). */
export type InboxHandlers = {
  acknowledgeTaxSource?: FormAction;
  applyOfficialRate?: FormAction;
  undoOfficialRate?: FormAction;
  recordBankPayment?: FormAction;
  approveRdfSwitch?: FormAction;
  confirmFilingFrequency?: FormAction;
  approveRuleChange?: FormAction;
  dismissRuleChange?: FormAction;
};

export type InboxActionOptions = {
  handlers?: InboxHandlers;
  /** Where "Snooze…" goes (Today opens its snooze sheet from this link). Omit to leave Snooze out (customer record). */
  snoozeHref?: (todoKey: string) => string;
};

function formPrimary(item: ExceptionItem, handlers: InboxHandlers | undefined): ActionSpec | null {
  const action = item.action;
  if (!action) return null;
  switch (action.type) {
    case "ACK_TAX_SOURCE_CHANGE":
      return handlers?.acknowledgeTaxSource
        ? { kind: "form", label: action.label, action: handlers.acknowledgeTaxSource, fields: { watchId: action.id, watchVersion: action.version }, primary: true }
        : null;
    case "APPLY_OFFICIAL_RATE":
      return handlers?.applyOfficialRate
        ? { kind: "form", label: action.label, action: handlers.applyOfficialRate, fields: { observationId: action.id }, primary: true }
        : null;
    case "APPROVE_RULE_CHANGE":
      return handlers?.approveRuleChange
        ? { kind: "form", label: action.label, action: handlers.approveRuleChange, fields: { observationId: action.id }, primary: true, pendingLabel: "Approving…", successMessage: "Rule updated from the official page" }
        : null;
    case "APPROVE_RDF_SWITCH":
      return handlers?.approveRdfSwitch
        ? { kind: "form", label: action.label, action: handlers.approveRdfSwitch, fields: { switchId: action.id }, primary: true, pendingLabel: "Approving…", successMessage: "Switch approved" }
        : null;
    case "CONFIRM_FILING_FREQUENCY":
      return handlers?.confirmFilingFrequency
        ? { kind: "form", label: action.label, action: handlers.confirmFilingFrequency, fields: { adviceId: action.id }, primary: true, pendingLabel: "Confirming…", successMessage: "Filing frequency updated" }
        : null;
    case "RECORD_BANK_PAYMENT":
      return handlers?.recordBankPayment
        ? { kind: "form", label: action.label, action: handlers.recordBankPayment, fields: { rowId: action.id }, primary: true, pendingLabel: "Recording…", successMessage: "Payment recorded" }
        : null;
    case "UNDO_OFFICIAL_RATE":
      return handlers?.undoOfficialRate
        ? { kind: "form", label: action.label, action: handlers.undoOfficialRate, fields: { rateVersionId: action.id }, primary: true }
        : null;
  }
}

function httpsSource(href: string | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href).protocol === "https:" ? href : null;
  } catch {
    return null;
  }
}

export function inboxActions(item: ExceptionItem, options: InboxActionOptions = {}): { actions: ActionSpec[]; overflow: MenuItem[] } {
  const form = formPrimary(item, options.handlers);
  const link = todoAction(item);
  const primary: ActionSpec = form ?? { kind: "link", label: link.label, href: link.href, primary: true };
  const actions: ActionSpec[] = [primary];
  // TFA-3: a rule reading is answered Approve / Not right — the dismiss
  // rides as a second form button beside Approve (owner handlers only).
  if (item.action?.type === "APPROVE_RULE_CHANGE" && options.handlers?.dismissRuleChange) {
    actions.push({
      kind: "form", label: "Not right", action: options.handlers.dismissRuleChange,
      fields: { observationId: item.action.id }, pendingLabel: "Marking…", successMessage: "Marked not right — it will not ask again",
    });
  }
  if (item.contact?.phone) actions.push({ kind: "tel", label: "Call", phone: item.contact.phone });
  else if (item.contact?.email) actions.push({ kind: "mailto", label: "Email", email: item.contact.email });

  const overflow: MenuItem[] = [];
  if (item.todoKey && options.snoozeHref) overflow.push({ kind: "link", label: "Snooze…", href: options.snoozeHref(item.todoKey) });
  if (form) overflow.push({ kind: "link", label: "Open", href: item.href });
  const source = httpsSource(item.sourceHref);
  if (source) overflow.push({ kind: "link", label: "View source", href: source });
  return { actions, overflow };
}
