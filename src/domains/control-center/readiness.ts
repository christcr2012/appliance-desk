import { listSwitches } from "@/domains/settings/switches";
import { getAutomationHealth } from "@/domains/automation/health";
import { countWaitingApprovals } from "@/domains/approvals";

/** O-6: read-only "what is the state right now" cards. Each one is loaded on its own so one failure never hides the rest. */
export type ReadinessState = "READY" | "NEEDS_SETUP" | "WAITING_FOR_OWNER" | "UNAVAILABLE" | "OFF";
export type ReadinessCard = {
  id: string;
  label: string;
  state: ReadinessState;
  detail: string;
  href: string;
  checkedAt: Date;
};

export const READINESS_STATE_TEXT: Record<ReadinessState, string> = {
  READY: "Ready",
  NEEDS_SETUP: "Needs attention",
  WAITING_FOR_OWNER: "Waiting for you",
  UNAVAILABLE: "Can't check right now",
  OFF: "Off",
};

type Loader = { id: string; label: string; href: string; ownerOnly?: boolean; load: (now: Date) => Promise<Pick<ReadinessCard, "state" | "detail">> };

const LOADERS: Loader[] = [
  {
    id: "customer-messages", label: "Email and text to customers", href: "/desk/settings/switches",
    async load() {
      const rows = await listSwitches();
      const email = rows.find((r) => r.id === "customer-email");
      const sms = rows.find((r) => r.id === "sms");
      if (!email || !sms) return { state: "UNAVAILABLE", detail: "The switch list did not include email and text." };
      const on = [email.on ? "email" : null, sms.on ? "text" : null].filter(Boolean);
      if (on.length === 0) return { state: "OFF", detail: "Email and text to customers are both switched off, so no customer is being messaged." };
      // Delivery is never proven by a setting, so this is "waiting for you" until you have seen a real message arrive.
      return { state: "WAITING_FOR_OWNER", detail: `Switched on: ${on.join(" and ")}. Email service: ${rows.find((r) => r.id === "email-provider")?.state ?? "unknown"}.` };
    },
  },
  {
    id: "card-payments", label: "Card payments", href: "/desk/settings?section=integrations",
    async load() {
      const row = (await listSwitches()).find((r) => r.id === "payments");
      if (!row) return { state: "UNAVAILABLE", detail: "Card payment status is not available." };
      if (/^Live key/.test(row.state)) return { state: "WAITING_FOR_OWNER", detail: row.state };
      if (/^Test key|^No recognized|^Unavailable/.test(row.state)) return { state: "NEEDS_SETUP", detail: row.state };
      return { state: "UNAVAILABLE", detail: row.state };
    },
  },
  {
    id: "background-jobs", label: "Background jobs", href: "/desk/automations",
    async load(now) {
      const rows = await getAutomationHealth(now);
      const failing = rows.filter((r) => r.state === "failing").length;
      const setup = rows.filter((r) => r.state === "unconfigured").length;
      if (failing > 0) return { state: "NEEDS_SETUP", detail: `${failing} background job${failing === 1 ? " is" : "s are"} failing.` };
      if (setup > 0) return { state: "NEEDS_SETUP", detail: `${setup} background job${setup === 1 ? " needs" : "s need"} a setting before it can run.` };
      return { state: "READY", detail: "No background job is reporting a failure." };
    },
  },
  {
    id: "approvals", label: "Approvals", href: "/desk/approvals", ownerOnly: true,
    async load(now) {
      const n = await countWaitingApprovals(now);
      return n > 0
        ? { state: "WAITING_FOR_OWNER", detail: `${n} request${n === 1 ? " is" : "s are"} waiting for your yes or no.` }
        : { state: "READY", detail: "Nothing is waiting for approval." };
    },
  },
];

export async function loadReadiness(role: string, now = new Date()): Promise<ReadinessCard[]> {
  const loaders = LOADERS.filter((l) => !l.ownerOnly || role === "OWNER");
  return Promise.all(loaders.map(async (l) => {
    try {
      const r = await l.load(now);
      return { id: l.id, label: l.label, href: l.href, checkedAt: now, ...r };
    } catch {
      return { id: l.id, label: l.label, href: l.href, checkedAt: now, state: "UNAVAILABLE" as const, detail: "This could not be checked just now. The other cards still work." };
    }
  }));
}
