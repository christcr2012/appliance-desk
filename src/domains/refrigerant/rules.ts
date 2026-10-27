// OPS-2: plain rules for refrigerant records. Pure: no database, no network.
// Facts: docs/research/2026-10-25-operating-risks.md item 2 (40 CFR 82.155: the person who scraps a refrigerant appliance
// must be able to show it was recovered, or that it had already leaked, and the scrap yard needs a signed statement).
export const REFRIGERANT_TYPES = ["R-134a", "R-600a (isobutane)", "R-12", "R-22", "R-290 (propane)", "R-404A", "R-410A", "Unknown — not on the nameplate"] as const;
export const OUTCOME_LABELS = {
  RECOVERED: "The refrigerant was recovered with recovery equipment",
  LEAKED_BEFORE: "It had already leaked out before I got it (I did not cut any lines)",
} as const;
export type RefrigerantOutcomeName = keyof typeof OUTCOME_LABELS;

export type PlanForGate = { choice: "SELL" | "STRIP" | "SCRAP" | "DISPOSE" | "OTHER"; remainder: string | null };

/** Scrapping, throwing away, or stripping and then scrapping/throwing away the rest ends the appliance's life: the statement is needed. */
export function refrigerantRecordRequired(hasRefrigerant: boolean, plan: PlanForGate): boolean {
  if (!hasRefrigerant) return false;
  if (plan.choice === "SCRAP" || plan.choice === "DISPOSE") return true;
  if (plan.choice === "STRIP") return plan.remainder === "SCRAPPED" || plan.remainder === "THROWN_AWAY" || plan.remainder === null;
  return false;
}

export const MISSING_RECORD_MESSAGE =
  "Scrap yards must get a signed statement that the refrigerant was removed. Record it first (on this appliance's page, under Refrigerant record).";

export type RefrigerantInput = {
  refrigerantType: string;
  outcome: RefrigerantOutcomeName;
  recoveredByName: string;
  recoveredByAddress: string;
  certificationNumber?: string;
  equipmentUsed?: string;
  recoveredOnKey: string;
  recyclerName?: string;
  receiptReference?: string;
  certify: boolean;
};

const clean = (value: string | undefined, max: number) => (value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

/** Trims the text and says what is missing, in plain words. Returns the problem list (empty when fine). */
export function checkRefrigerantInput(input: RefrigerantInput): { problems: string[]; clean: Omit<RefrigerantInput, "recoveredOnKey" | "certify"> } {
  const problems: string[] = [];
  const type = clean(input.refrigerantType, 60);
  if (!type) problems.push("Choose the refrigerant type (pick \"Unknown\" if it isn't on the nameplate).");
  if (input.outcome !== "RECOVERED" && input.outcome !== "LEAKED_BEFORE") problems.push("Say whether the refrigerant was recovered or had already leaked.");
  const name = clean(input.recoveredByName, 120);
  const address = clean(input.recoveredByAddress, 200);
  if (input.outcome === "RECOVERED" && !name) problems.push("Enter the name of the person or shop that recovered it.");
  if (input.outcome === "RECOVERED" && !address) problems.push("Enter their address.");
  if (input.outcome === "LEAKED_BEFORE" && !name) problems.push("Enter your name (you are making the statement).");
  if (!input.certify) problems.push("Tick the box to sign the statement.");
  return {
    problems,
    clean: {
      refrigerantType: type, outcome: input.outcome, recoveredByName: name, recoveredByAddress: address || "—",
      certificationNumber: clean(input.certificationNumber, 60) || undefined, equipmentUsed: clean(input.equipmentUsed, 120) || undefined,
      recyclerName: clean(input.recyclerName, 120) || undefined, receiptReference: clean(input.receiptReference, 120) || undefined,
    },
  };
}

/** The earliest date the record may be removed: the recovery date plus the rule-book number of years. */
export function keepUntil(recoveredOn: Date, years: number): Date {
  const d = new Date(recoveredOn.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}
