import { prisma } from "@/lib/prisma";
import { providerStatus } from "./provider-status";
import { twoFactorRolesFromSetting } from "@/domains/security/two-factor";

/**
 * One read-only list of every on/off that affects customers or money (Batch O, O-6 / design D-O6).
 * No new switches are created here: each row says what it is now, who changed it last and when, and where to change it.
 * Secret keys are never read into this list, only whether their prefix says test or live.
 */
export type SwitchRow = {
  id: string;
  name: string;
  state: string;
  on: boolean | null;
  lastChange: { by: string; at: Date } | null;
  changeAt: string;
};

async function lastBy(actions: string[]) {
  const row = await prisma.auditLog.findFirst({
    where: { action: { in: actions } },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true, email: true } } },
  });
  return row ? { by: row.user?.name || row.user?.email || "Someone", at: row.createdAt } : null;
}

export async function listSwitches(): Promise<SwitchRow[]> {
  const s = await prisma.businessSettings.findUnique({ where: { id: "singleton" } });
  const paused = Array.isArray(s?.pausedAutomations) ? (s!.pausedAutomations as unknown[]).length : 0;
  const providers = providerStatus();
  const pick = (n: string) => providers.find((p) => p.name === n)?.state ?? "Unknown";
  const roles = twoFactorRolesFromSetting(s?.twoFactorRequiredRoles);
  const [email, renew, twoFactor] = await Promise.all([
    lastBy(["settings.customer_email_on", "settings.customer_email_off"]),
    lastBy(["settings.auto_renew_on", "settings.auto_renew_off"]),
    lastBy(["security.two_factor.policy"]),
  ]);
  return [
    { id: "customer-email", name: "Email to customers", on: Boolean(s?.customerEmailEnabled), state: s?.customerEmailEnabled ? "On" : "Off", lastChange: email, changeAt: "/desk/settings?section=notifications" },
    { id: "email-provider", name: "Email service", on: null, state: pick("Email"), lastChange: null, changeAt: "/desk/settings?section=integrations" },
    { id: "sms", name: "Text messages (SMS)", on: Boolean(s?.customerSmsEnabled), state: `${s?.customerSmsEnabled ? "Switched on" : "Switched off"} (${pick("SMS")})`, lastChange: null, changeAt: "/desk/settings/telecom" },
    { id: "auto-renew", name: "Automatic renewals", on: Boolean(s?.autoRenewEnabled), state: s?.autoRenewEnabled ? "On" : "Off", lastChange: renew, changeAt: "/desk/settings?section=terms" },
    { id: "paused-automations", name: "Paused automations", on: paused > 0, state: paused === 0 ? "None paused" : `${paused} paused`, lastChange: null, changeAt: "/desk/automations" },
    { id: "payments", name: "Card payments (Stripe)", on: null, state: pick("Payments"), lastChange: null, changeAt: "/desk/settings?section=integrations" },
    { id: "two-factor", name: "Two-step sign-in required for", on: roles.length > 0, state: roles.length ? roles.join(", ") : "Nobody", lastChange: twoFactor, changeAt: "/desk/settings?section=security" },
    { id: "books-start", name: "Books start date", on: Boolean(s?.booksStartDate), state: s?.booksStartDate ? s.booksStartDate.toISOString().slice(0, 10) : "Not set, so the books are not posting yet", lastChange: null, changeAt: "/desk/books" },
  ];
}
