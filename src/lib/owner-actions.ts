import type { Capability } from "@/domains/capabilities";

/**
 * O-6: the "Manage my business" map. A code-owned list of owner/admin tasks, each pointing at an EXISTING desk screen.
 * It is navigation only: it never grants access, never runs an action and never stores anything. Each target screen
 * still does its own sign-in, role and permission checks. `access` and `capability` only decide whether a card is shown
 * (the server drops cards a person could not use, so they are absent from the page data, not just hidden).
 */
export const OWNER_ACTION_GROUPS = [
  { id: "website", label: "Website and promotions" },
  { id: "prices", label: "Prices and agreements" },
  { id: "customers", label: "Customers and service" },
  { id: "equipment", label: "Equipment and purchasing" },
  { id: "money", label: "Money and taxes" },
  { id: "communications", label: "Messages to customers" },
  { id: "team", label: "Team and permissions" },
  { id: "health", label: "Health and recovery" },
] as const;
export type OwnerActionGroup = (typeof OWNER_ACTION_GROUPS)[number]["id"];

export type OwnerAction = {
  id: string;
  label: string;
  group: OwnerActionGroup;
  /** What opening it lets you do, in plain words. Shown before the person clicks. */
  summary: string;
  /** Words an owner might type that are not in the label ("rent" for prices, "stop reminders" for notifications). */
  synonyms: string[];
  href: string;
  /** "owner" = owner only; "admin" = owner and admins. */
  access: "owner" | "admin";
  /** If set, an admin the owner has limited from this is not shown the card. */
  capability?: Capability;
};

export const OWNER_ACTIONS: OwnerAction[] = [
  { id: "website", label: "Website words, pictures and promotions", group: "website", access: "admin",
    summary: "Change what your public website says and shows, including any promotion.", synonyms: ["website picture", "photo", "banner", "homepage", "promotion", "coupon", "sale", "text on site"], href: "/desk/settings/website" },
  { id: "business-profile", label: "Business name, phone, hours and logo", group: "website", access: "admin", capability: "EDIT_SETTINGS",
    summary: "Your public business details, opening hours and holiday closures.", synonyms: ["phone number", "address", "hours", "holiday", "logo", "email address"], href: "/desk/settings?section=profile" },
  { id: "service-area", label: "Where you deliver", group: "website", access: "admin", capability: "EDIT_SETTINGS",
    summary: "The cities and zip codes you serve.", synonyms: ["zip", "delivery area", "cities", "territory"], href: "/desk/settings?section=service-area" },

  { id: "appliance-prices", label: "Appliance rents and packages", group: "prices", access: "admin", capability: "EDIT_SETTINGS",
    summary: "Change the monthly price of an appliance or a package right now.", synonyms: ["change rent", "price", "monthly rent", "raise price", "lower price", "package"], href: "/desk/settings?section=products" },
  { id: "price-changes", label: "Schedule a price change for later", group: "prices", access: "admin", capability: "EDIT_SETTINGS",
    summary: "Pick a start day; the new price applies that day. Signed rentals keep their price.", synonyms: ["future price", "price increase", "start date", "raise rent next month"], href: "/desk/settings/price-changes" },
  { id: "rental-policies", label: "Fees and rental rules", group: "prices", access: "admin", capability: "EDIT_SETTINGS",
    summary: "Late fees, deposits, notice periods and other rules new rentals use.", synonyms: ["late fee", "deposit", "policy", "grace period", "notice"], href: "/desk/settings/policies" },
  { id: "ending-rentals", label: "Ending and renewing rentals", group: "prices", access: "owner",
    summary: "What happens when a rental term runs out and how far ahead customers are warned.", synonyms: ["renewal", "auto renew", "month to month", "term ends", "cancel rental"], href: "/desk/settings/rental-endings" },
  { id: "unsigned-follow-up", label: "Unsigned agreement reminders", group: "prices", access: "owner",
    summary: "How long to wait before reminding you about an agreement nobody has signed.", synonyms: ["signature", "sign", "unsigned", "contract reminder"], href: "/desk/settings/unsigned-follow-up" },
  { id: "new-rental", label: "Start a new rental", group: "prices", access: "admin",
    summary: "Write up a new rental agreement for a customer.", synonyms: ["new agreement", "new customer rental", "contract"], href: "/desk/agreements/new" },
  { id: "quotes", label: "Quotes", group: "prices", access: "admin",
    summary: "See, send or follow up on quotes.", synonyms: ["estimate", "proposal", "bid"], href: "/desk/estimates" },

  { id: "leads", label: "New inquiries", group: "customers", access: "admin",
    summary: "People who asked about renting and still need an answer.", synonyms: ["lead", "inquiry", "contact form", "who asked", "new customer"], href: "/desk/leads" },
  { id: "customers", label: "Customers", group: "customers", access: "admin",
    summary: "Look up a customer, their rentals, balance and history.", synonyms: ["customer list", "find customer", "account"], href: "/desk/customers" },
  { id: "schedule", label: "Deliveries, pickups and visits", group: "customers", access: "admin",
    summary: "The schedule: who goes where and when.", synonyms: ["dispatch", "delivery", "pickup", "driver", "route", "calendar", "job"], href: "/desk/dispatch" },
  { id: "repairs", label: "Repairs", group: "customers", access: "admin",
    summary: "Repair requests and appliances out for service.", synonyms: ["maintenance", "broken", "fix appliance", "service call"], href: "/desk/maintenance" },
  { id: "lead-response", label: "How fast to answer new inquiries", group: "customers", access: "owner",
    summary: "The reminder that fires when an inquiry sits too long.", synonyms: ["response time", "follow up", "slow answer"], href: "/desk/settings/lead-response" },
  { id: "visit-scheduling", label: "Visit and scheduling rules", group: "customers", access: "admin", capability: "EDIT_SETTINGS",
    summary: "Visit lengths, windows and how jobs are scheduled.", synonyms: ["time window", "appointment", "visit length"], href: "/desk/settings?section=jobs" },

  { id: "equipment", label: "Equipment", group: "equipment", access: "admin",
    summary: "Every appliance you own, where it is and what shape it is in.", synonyms: ["inventory", "appliance list", "fleet", "serial number", "asset"], href: "/desk/inventory" },
  { id: "retired", label: "Retired appliances: what is next", group: "equipment", access: "admin",
    summary: "Decide to sell, strip, scrap or throw away appliances you took out of service.", synonyms: ["scrap", "sell old", "junk", "dispose", "strip for parts"], href: "/desk/inventory/retired" },
  { id: "parts", label: "Parts shelf", group: "equipment", access: "admin",
    summary: "Parts you keep on hand and what is running low.", synonyms: ["spare parts", "stock", "supplies"], href: "/desk/parts" },
  { id: "purchases", label: "Appliance purchases", group: "equipment", access: "admin",
    summary: "Record appliances you bought and the receipt for them.", synonyms: ["bought", "receipt", "buy appliance", "acquisition"], href: "/desk/purchases" },
  { id: "purchase-orders", label: "Orders to suppliers", group: "equipment", access: "admin",
    summary: "Parts and appliances you ordered and are waiting on.", synonyms: ["purchase order", "po", "order parts"], href: "/desk/purchase-orders" },
  { id: "suppliers", label: "Suppliers", group: "equipment", access: "admin",
    summary: "Who you buy from.", synonyms: ["vendor", "dealer"], href: "/desk/suppliers" },

  { id: "money", label: "Money: invoices and payments", group: "money", access: "admin",
    summary: "What customers owe, what came in, and unpaid invoices.", synonyms: ["invoice", "unpaid", "who owes", "past due", "collect", "bill"], href: "/desk/billing" },
  { id: "held-payments", label: "Payments held for review", group: "money", access: "admin",
    summary: "Customer payments that need your decision before they count.", synonyms: ["failed payment", "fix payment", "payment problem", "declined card", "hold"], href: "/desk/billing/held-payments" },
  { id: "bank-match", label: "Match payments to the bank", group: "money", access: "admin",
    summary: "Check that what the bank shows matches what the desk shows.", synonyms: ["reconcile", "bank statement", "deposit match"], href: "/desk/billing/reconciliation" },
  { id: "revenue", label: "Revenue and reports", group: "money", access: "admin",
    summary: "How the business is doing: income, trends and reports.", synonyms: ["income", "profit", "how am i doing", "numbers", "report"], href: "/desk/revenue" },
  { id: "expenses", label: "Expenses and receipts", group: "money", access: "admin",
    summary: "Costs you paid and the receipts for them.", synonyms: ["cost", "spend", "receipt", "bill i paid"], href: "/desk/expenses" },
  { id: "books", label: "Books and year-end", group: "money", access: "admin",
    summary: "Your books, cash, month-end closing and exports for your accountant.", synonyms: ["accounting", "accountant", "ledger", "close the month", "export", "cpa"], href: "/desk/books" },
  { id: "sales-tax", label: "Sales tax", group: "money", access: "admin",
    summary: "Tax setup, returns and records.", synonyms: ["tax return", "colorado tax", "taxable", "dor", "use tax"], href: "/desk/sales-tax" },
  { id: "approvals", label: "Requests waiting for your approval", group: "money", access: "owner",
    summary: "Things an admin started that were over your limit.", synonyms: ["approve", "decline", "admin request"], href: "/desk/approvals" },
  { id: "approval-limits", label: "Approval limits", group: "money", access: "owner",
    summary: "The dollar amounts above which an admin needs your yes.", synonyms: ["limit", "approval threshold", "admin spending"], href: "/desk/settings/approvals" },
  { id: "payment-links", label: "Payment links", group: "money", access: "owner",
    summary: "Links customers use to pay you.", synonyms: ["pay link", "online payment", "card payment"], href: "/desk/settings/payment-links" },

  { id: "notifications", label: "Which messages customers get", group: "communications", access: "admin", capability: "EDIT_SETTINGS",
    summary: "Turn reminders and notices on or off and edit their wording.", synonyms: ["stop reminders", "email to customers", "text messages", "reminder", "notification"], href: "/desk/settings?section=notifications" },
  { id: "switches", label: "Everything that emails, texts or moves money", group: "communications", access: "admin",
    summary: "One read-only list of what is on or off, with who last changed it.", synonyms: ["is email on", "live", "turn off", "sms", "stripe live"], href: "/desk/settings/switches" },
  { id: "phone-text", label: "Phone and text setup", group: "communications", access: "admin",
    summary: "Your business number, texting and call forwarding.", synonyms: ["twilio", "call", "sms", "text number"], href: "/desk/settings/telecom" },
  { id: "communications", label: "Conversations with customers", group: "communications", access: "admin",
    summary: "Messages and calls with customers.", synonyms: ["inbox", "messages", "call log", "sent email"], href: "/desk/communications" },

  { id: "permissions", label: "What each admin may do", group: "team", access: "owner",
    summary: "Take a money or settings permission away from one admin.", synonyms: ["admin access", "limit admin", "permission", "who can refund"], href: "/desk/settings/permissions" },
  { id: "staff", label: "Staff and admin accounts", group: "team", access: "admin", capability: "EDIT_SETTINGS",
    summary: "Add, change or archive team members.", synonyms: ["add employee", "new user", "remove employee", "reset password", "driver account"], href: "/desk/settings?section=staff" },
  { id: "security", label: "Sign-in security", group: "team", access: "admin",
    summary: "Two-step sign-in for you and your team.", synonyms: ["two factor", "2fa", "password", "authenticator", "login"], href: "/desk/security/setup" },
  { id: "activity", label: "Who changed what", group: "team", access: "admin",
    summary: "The activity log.", synonyms: ["audit", "history", "who did this", "log"], href: "/desk/activity" },

  { id: "system-health", label: "Is everything running?", group: "health", access: "admin",
    summary: "Whether the background jobs and connections are healthy.", synonyms: ["errors", "broken", "automation", "not working", "cron"], href: "/desk/automations" },
  { id: "launch", label: "What is left before real customers", group: "health", access: "admin",
    summary: "The launch checklist.", synonyms: ["go live", "checklist", "ready to launch"], href: "/desk/launch" },
  { id: "undo", label: "Settings history and undo", group: "health", access: "admin",
    summary: "See every settings change and undo one.", synonyms: ["revert", "oops", "change back", "undo setting"], href: "/desk/settings/history" },
  { id: "paperwork", label: "Business paperwork and renewals", group: "health", access: "owner",
    summary: "Your LLC, EIN, licenses and insurance with renewal reminders.", synonyms: ["license", "insurance", "llc", "ein", "renewal date"], href: "/desk/paperwork" },
  { id: "privacy", label: "Privacy requests", group: "health", access: "owner",
    summary: "Customers asking to see or delete their information.", synonyms: ["delete my data", "gdpr", "ccpa", "data request"], href: "/desk/privacy" },
];

export type Role = "OWNER" | "ADMIN" | string;

/** Pure: which cards this person may be shown. `limited` = capabilities the owner took away from this admin. */
export function visibleOwnerActions(role: Role, limited: readonly Capability[] = []): OwnerAction[] {
  if (role !== "OWNER" && role !== "ADMIN") return [];
  return OWNER_ACTIONS.filter((a) => {
    if (a.access === "owner" && role !== "OWNER") return false;
    if (a.capability && role === "ADMIN" && limited.includes(a.capability)) return false;
    return true;
  });
}

function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 1);
}

const STOP = new Set(["to", "my", "the", "of", "an", "on", "in", "for", "is", "it", "do", "how", "can", "and", "or", "me", "up", "at", "be"]);

/**
 * Pure keyword search over label, summary and synonyms (not an AI service). Every word typed must match the start of some
 * word in the card, so "change rent" finds "Appliance rents..." through its synonyms. Best matches first; ties keep list order.
 */
export function searchOwnerActions(actions: readonly OwnerAction[], query: string): OwnerAction[] {
  const words = tokens(query.slice(0, 100)).filter((w) => !STOP.has(w)).slice(0, 8);
  if (words.length === 0) return [];
  const scored: Array<{ a: OwnerAction; score: number; i: number }> = [];
  actions.forEach((a, i) => {
    const label = tokens(a.label);
    const syn = a.synonyms.flatMap(tokens);
    const rest = tokens(a.summary);
    let score = 0;
    for (const w of words) {
      const hit = (list: string[], weight: number) => (list.some((t) => t.startsWith(w) || (w.length >= 4 && w.startsWith(t) && t.length >= 4)) ? weight : 0);
      const s = Math.max(hit(label, 3), hit(syn, 2), hit(rest, 1));
      if (s === 0) { score = 0; break; }
      score += s;
    }
    if (score > 0) scored.push({ a, score, i });
  });
  return scored.sort((x, y) => y.score - x.score || x.i - y.i).slice(0, 12).map((s) => s.a);
}
