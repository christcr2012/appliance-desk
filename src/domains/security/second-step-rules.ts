// ACC-3: pure rules for how a person gets their second sign-in step. No database here.

export const SECOND_STEP_METHODS = ["TOTP", "SMS", "EMAIL"] as const;
export type SecondStepMethod = (typeof SECOND_STEP_METHODS)[number];
export type PolicyLevel = "OWNER" | "ADMIN" | "STAFF";
export type MethodPolicy = Record<PolicyLevel, SecondStepMethod[]>;

export const METHOD_LABEL: Record<SecondStepMethod, string> = {
  TOTP: "Authenticator app",
  SMS: "Text message code",
  EMAIL: "Email code",
};

/** Starting value: Chris answered IN-85 "no" on 2026-10-23, so owner and admins do not get email codes. */
export const RECOMMENDED_METHOD_POLICY: MethodPolicy = {
  OWNER: ["TOTP", "SMS"],
  ADMIN: ["TOTP", "SMS"],
  STAFF: ["TOTP", "SMS", "EMAIL"],
};

export const SIGN_IN_CODE_MINUTES = 5;

export function isSecondStepMethod(value: unknown): value is SecondStepMethod {
  return typeof value === "string" && (SECOND_STEP_METHODS as readonly string[]).includes(value);
}

/** Reads the stored policy. Anything missing or malformed falls back to the recommended value for that level. */
export function methodPolicyFromSetting(value: unknown): MethodPolicy {
  const out = {} as MethodPolicy;
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  for (const level of ["OWNER", "ADMIN", "STAFF"] as const) {
    const raw = source[level];
    const list = Array.isArray(raw) ? raw.filter(isSecondStepMethod) : [];
    out[level] = list.length > 0 ? [...new Set(list)] : [...RECOMMENDED_METHOD_POLICY[level]];
  }
  return out;
}

/** The authenticator app is always allowed, so no policy can leave a level with no way to sign in. */
export function normalizeMethodPolicy(input: Partial<Record<PolicyLevel, unknown>>): MethodPolicy {
  const out = {} as MethodPolicy;
  for (const level of ["OWNER", "ADMIN", "STAFF"] as const) {
    const raw = input[level];
    const list = Array.isArray(raw) ? raw.filter(isSecondStepMethod) : [];
    out[level] = [...new Set<SecondStepMethod>(["TOTP", ...list])];
  }
  return out;
}

export function allowedMethodsFor(role: string, policy: MethodPolicy): SecondStepMethod[] {
  if (role === "OWNER" || role === "ADMIN" || role === "STAFF") return policy[role];
  // ACCT-1: the accountant is not part of the owner's per-level method policy;
  // their second step is the authenticator app, which needs no business
  // channels and is always available.
  if (role === "ACCOUNTANT") return ["TOTP"];
  return [];
}

/** Text codes go out only when production, the keys and the owner's own switch are all in place. */
export function textCodesAvailable(input: { production: boolean; keysPresent: boolean; switchOn: boolean }): boolean {
  return input.production && input.keysPresent && input.switchOn;
}

export function makeSixDigitCode(random: (max: number) => number): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += String(random(10));
  return out;
}

export const EMAIL_WEAKER_WARNING =
  "Email codes are weaker for the owner and admins: the forgot-password link also goes to email, so anyone who gets into that inbox could reset the password and receive the sign-in code. A text or the authenticator app keeps the two steps on different things.";
