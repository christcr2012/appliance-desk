// ACC-5: job roles. A job role is a named list of desk screens on top of an access level. It can only NARROW what the
// level already allows (staff/admin checks stay in force everywhere); it never widens. Pure rules, no database.

export type JobRoleLevel = "STAFF" | "ADMIN";

/** The screens an owner can switch on or off. Several desk addresses can belong to one screen (see PATH_TO_SCREEN). */
export const SCREENS = {
  tasks: { label: "Tasks", money: false },
  leads: { label: "Leads", money: false },
  customers: { label: "Customers", money: false },
  communications: { label: "Communications (messages inbox)", money: false },
  agreements: { label: "Rentals", money: false },
  "phone-orders": { label: "Phone orders", money: false },
  estimates: { label: "Quotes", money: true },
  dispatch: { label: "Schedule, jobs and driver view", money: false },
  maintenance: { label: "Repairs", money: false },
  inventory: { label: "Equipment, parts and purchasing", money: false },
  billing: { label: "Money, revenue, reports and fleet", money: true },
  "sales-tax": { label: "Taxes", money: true },
  books: { label: "Books", money: true },
  expenses: { label: "Expenses", money: true },
  suppliers: { label: "Suppliers", money: true },
  activity: { label: "Activity (who changed what)", money: false },
  management: { label: "Settings, paperwork, privacy, system health and growth", money: true },
  // MCP-10a: reading and answering everyone's app feedback. Owner/admin only (reports can hold personal details).
  feedback: { label: "App feedback from customers and the team", money: true },
} as const;
export type ScreenKey = keyof typeof SCREENS;
export const SCREEN_KEYS = Object.keys(SCREENS) as ScreenKey[];

/** Screens everyone on the team always has, whatever their job role (so nobody is locked out of their own account). */
export const ALWAYS_ALLOWED = ["today", "account", "security", "notices", "search", "more"] as const;

/** First address segment under /desk -> the screen it belongs to. */
const PATH_TO_SCREEN: Record<string, ScreenKey> = {
  tasks: "tasks", leads: "leads", customers: "customers", communications: "communications", agreements: "agreements",
  "phone-orders": "phone-orders", estimates: "estimates",
  dispatch: "dispatch", jobs: "dispatch", driver: "dispatch",
  maintenance: "maintenance",
  inventory: "inventory", parts: "inventory", purchases: "inventory", "purchase-orders": "inventory",
  billing: "billing", sales: "billing", revenue: "billing", reports: "billing", fleet: "billing", dashboard: "billing",
  compliance: "sales-tax",
  "sales-tax": "sales-tax", books: "books", expenses: "expenses", suppliers: "suppliers", activity: "activity",
  settings: "management", paperwork: "management", privacy: "management", automations: "management", growth: "management",
  launch: "management", "control-center": "management", approvals: "management",
  // OPS-8: owner-only; a job role that includes Settings can open it, nobody else.
  continuity: "management",
  // OPS-3: vehicles and mileage are expense-side money screens.
  vehicle: "expenses",
  // OPS-4: owner-only; a job role that includes Settings can open it, nobody else.
  insurance: "management",
  // OPS-7: privacy and security duties sit with the other owner-level settings.
  "privacy-security": "management",
  // SETUP-1: owner-only; a job role that includes Settings can open it, nobody else.
  "setup-guide": "management",
  vault: "management",
  feedback: "feedback",
};

export function isScreenKey(value: string): value is ScreenKey {
  return Object.hasOwn(SCREENS, value);
}

/** What the screen is, from a /desk address. "always" = open to every team member; null = not a known desk screen. */
export function screenForPath(pathname: string | null | undefined): ScreenKey | "always" | null {
  if (!pathname) return null;
  const clean = pathname.split("?")[0].split("#")[0];
  if (clean === "/desk" || clean === "/desk/") return "always";
  if (!clean.startsWith("/desk/")) return null;
  const first = clean.slice("/desk/".length).split("/")[0];
  if ((ALWAYS_ALLOWED as readonly string[]).includes(first)) return "always";
  // MCP-10a: everyone on the team can send app feedback and follow their own reports, whatever their job role.
  const second = clean.slice("/desk/".length).split("/")[1];
  if (first === "feedback" && (second === "new" || second === "mine")) return "always";
  return Object.hasOwn(PATH_TO_SCREEN, first) ? PATH_TO_SCREEN[first] : null;
}

/**
 * `screens` null means "no job role": the access level alone decides (nothing changes for people without one).
 * With a job role, an unknown address is DENIED (missing data never grants access).
 */
export function jobRoleAllowsPath(screens: readonly string[] | null, pathname: string | null | undefined): boolean {
  if (screens === null) return true;
  const screen = screenForPath(pathname);
  if (screen === "always") return true;
  if (screen === null) return false;
  return screens.includes(screen);
}

export function jobRoleAllowsScreen(screens: readonly string[] | null, screen: ScreenKey): boolean {
  return screens === null || screens.includes(screen);
}

export class JobRoleError extends Error {}

export const MAX_LABEL = 40;

/** Staff can never be given a money or settings screen here: that waits for the owner's answer to IN-13. */
export const STAFF_MONEY_SCREENS_ALLOWED = false;

export function validateJobRole(input: { label: unknown; accessLevel: unknown; screens: unknown; capabilityLimits?: unknown }, validCapabilities: readonly string[]) {
  const label = typeof input.label === "string" ? input.label.trim().replace(/\s+/g, " ") : "";
  if (!label) throw new JobRoleError("Give the job role a name.");
  if (label.length > MAX_LABEL) throw new JobRoleError(`Keep the name under ${MAX_LABEL} characters.`);
  if (input.accessLevel !== "STAFF" && input.accessLevel !== "ADMIN") throw new JobRoleError("A job role is for Staff or Admin.");
  const accessLevel: JobRoleLevel = input.accessLevel;
  const raw = Array.isArray(input.screens) ? input.screens : [];
  const screens: ScreenKey[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !isScreenKey(item)) throw new JobRoleError("That screen does not exist.");
    if (!screens.includes(item)) screens.push(item);
  }
  if (accessLevel === "STAFF" && !STAFF_MONEY_SCREENS_ALLOWED) {
    const money = screens.filter((s) => SCREENS[s].money);
    if (money.length > 0) {
      throw new JobRoleError(`Staff cannot be given money or settings screens (${money.map((s) => SCREENS[s].label).join(", ")}). Use an Admin job role for that.`);
    }
  }
  const limitsRaw = Array.isArray(input.capabilityLimits) ? input.capabilityLimits : [];
  const capabilityLimits: string[] = [];
  for (const item of limitsRaw) {
    if (typeof item !== "string" || !validCapabilities.includes(item)) throw new JobRoleError("That permission does not exist.");
    if (!capabilityLimits.includes(item)) capabilityLimits.push(item);
  }
  if (accessLevel === "STAFF" && capabilityLimits.length > 0) throw new JobRoleError("Permission limits apply to admin job roles only.");
  return { label, accessLevel, screens, capabilityLimits };
}

/** The four starting job roles (inserted by the migration; shown here so the owner can restore them). */
export const STARTER_JOB_ROLES: ReadonlyArray<{
  id: string; label: string; accessLevel: JobRoleLevel; screens: ScreenKey[]; capabilityLimits: string[];
}> = [
  { id: "jobrole-driver", label: "Driver / technician", accessLevel: "STAFF", screens: ["tasks", "dispatch", "maintenance", "inventory", "activity"], capabilityLimits: [] },
  { id: "jobrole-office", label: "Office", accessLevel: "STAFF", screens: ["tasks", "leads", "customers", "communications", "agreements", "phone-orders", "dispatch", "maintenance", "inventory", "activity"], capabilityLimits: [] },
  {
    id: "jobrole-bookkeeper", label: "Bookkeeper", accessLevel: "ADMIN",
    screens: ["tasks", "customers", "agreements", "estimates", "billing", "sales-tax", "books", "expenses", "suppliers", "activity"],
    capabilityLimits: ["EDIT_SETTINGS"],
  },
  { id: "jobrole-manager", label: "Manager", accessLevel: "ADMIN", screens: [...SCREEN_KEYS], capabilityLimits: [] },
];
