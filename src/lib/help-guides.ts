// AR-12: small, searchable task recipes. Links are stable desk routes, not unbuilt placeholder destinations.
import { jobRoleAllowsPath } from "@/domains/team/job-role-rules";

export type HelpGuide = {
  id: string;
  question: string;
  keywords: string[];
  steps: [string, string, string];
  href: string;
};

export const HELP_GUIDES: HelpGuide[] = [
  {
    id: "card-payment", question: "How do I take a card payment?",
    keywords: ["charge card", "customer pay", "credit card", "money"],
    steps: ["Open Money → Bills and find the unpaid bill.", "Open the bill and choose the card payment action.", "Read the amount and customer carefully before you confirm the payment."],
    href: "/desk/billing",
  },
  {
    id: "cash-check", question: "How do I record cash or a check?",
    keywords: ["cash", "check", "manual payment", "money"],
    steps: ["Open Money → Bills and choose the bill that was paid.", "Choose the option to record a payment and enter the amount and method.", "Check the details before saving; recording it does not charge a card."],
    href: "/desk/billing",
  },
  {
    id: "remind-payment", question: "How do I send a payment reminder?",
    keywords: ["late", "unpaid", "reminder", "collect"],
    steps: ["Open Money → Bills and find the bill that needs attention.", "Open its actions and look for the reminder option.", "Review the recipient and message before sending; do not assume a message was delivered."],
    href: "/desk/billing",
  },
  {
    id: "refund-payment", question: "How do I refund a payment?",
    keywords: ["refund", "return money", "charge"],
    steps: ["Open Money → Bills and find the customer's paid bill.", "Open the bill or linked rental to find the eligible refund action.", "Review the amount and destination before confirming; a refund moves real money."],
    href: "/desk/billing",
  },
  {
    id: "give-up-bill", question: "How do I give up on collecting a bill?",
    keywords: ["collections", "forgive", "uncollectible", "waive"],
    steps: ["Open Money → Bills and find the unpaid bill.", "Choose Give up on this bill… from the bill actions to open the customer statement.", "Review the amount and confirmation carefully before giving up on collecting the bill."],
    href: "/desk/billing",
  },
  {
    id: "start-rental", question: "How do I start a new rental?",
    keywords: ["rental", "agreement", "lease", "sign"],
    steps: ["Open New rental and choose the customer and location.", "Choose the rental term, price and appliances.", "Check the summary before sending the rental for signing."],
    href: "/desk/agreements/new",
  },
  {
    id: "send-quote", question: "How do I send a quote?",
    keywords: ["estimate", "lead", "price", "proposal"],
    steps: ["Open New quote and choose the customer.", "Add the requested appliances, work and prices.", "Save the quote, review the next screen, then choose Send."],
    href: "/desk/estimates/new",
  },
  {
    id: "schedule-delivery", question: "How do I schedule a delivery?",
    keywords: ["delivery", "driver", "visit", "route", "calendar"],
    steps: ["Open Schedule and find the signed rental.", "Choose an available day and visit for the delivery.", "Check the customer, address and assigned person before saving."],
    href: "/desk/dispatch",
  },
  {
    id: "schedule-pickup", question: "How do I schedule a pickup?",
    keywords: ["pickup", "return", "driver", "route", "visit"],
    steps: ["Open Schedule and find the rental that needs a pickup.", "Create or edit its pickup visit.", "Confirm the address, date and assigned person before saving."],
    href: "/desk/dispatch",
  },
  {
    id: "add-expense", question: "How do I add an expense?",
    keywords: ["cost", "receipt", "purchase", "spend"],
    steps: ["Open Expenses and go to Record an expense.", "Enter the date, seller, amount and how it was paid.", "Save or submit it; attach the receipt after the expense is saved."],
    href: "/desk/expenses#add-expense",
  },
  {
    id: "add-team", question: "How do I add a team member?",
    keywords: ["hire", "staff", "driver", "invite", "account"],
    steps: ["Open Settings and choose Team.", "Use the team invite or member controls to enter their details.", "Choose access carefully before sending an invitation."],
    href: "/desk/settings?section=staff",
  },
  {
    id: "retire-appliance", question: "How do I retire an appliance?",
    keywords: ["appliance", "broken", "scrap", "equipment", "dispose"],
    steps: ["Open Equipment and choose the appliance.", "Find its retirement or out-of-service action.", "Confirm what happens to the appliance and check any disposal follow-ups."],
    href: "/desk/inventory",
  },
  {
    id: "snooze-task", question: "How do I snooze a To do item?",
    keywords: ["today", "remind later", "pause task", "follow up"],
    steps: ["Open Today and find the To do item.", "Choose Snooze and select when it should come back.", "Save the change; use Undo if you snoozed the wrong item."],
    href: "/desk/today",
  },
  {
    id: "install-desk", question: "How do I install the desk app on my phone?",
    keywords: ["install", "home screen", "android", "iphone", "app"],
    steps: ["Open Today in Chrome on Android or Safari on iPhone.", "Use Install app on Android, or Share → Add to Home Screen on iPhone.", "Open the new Desk icon and sign in normally."],
    href: "/desk/today",
  },
  {
    id: "practice-safely", question: "How do I practice without affecting real customers?",
    keywords: ["practice", "testing", "demo", "learn", "safe"],
    steps: ["Open Settings to find Practice safely after the owner has set up the practice copy.", "If that link is missing, ask the owner; no separate practice app is available yet.", "Use only the practice copy with made-up customers, never a real payment or real message."],
    href: "/desk/settings",
  },
];

const STAFF_GUIDES = new Set(["add-expense", "install-desk"]);
// Staff can submit expenses but cannot snooze Today, schedule visits, take/refund payments, or change Settings.

/** Never advertise restricted destination actions to a role that cannot use them. The destination still guards itself. */
export function visibleHelpGuides(role: string | undefined, jobScreens: readonly string[] | null): HelpGuide[] {
  if (role !== "OWNER" && role !== "ADMIN" && role !== "STAFF") return [];
  return HELP_GUIDES.filter(guide =>
    (role !== "STAFF" || STAFF_GUIDES.has(guide.id))
    && jobRoleAllowsPath(jobScreens, guide.href),
  );
}

export function searchHelpGuides(guides: readonly HelpGuide[], query: string): HelpGuide[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [...guides];
  return guides.filter(guide =>
    [guide.question, ...guide.keywords].some(text => text.toLocaleLowerCase().includes(q)),
  );
}
