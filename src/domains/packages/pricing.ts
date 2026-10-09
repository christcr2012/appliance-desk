/**
 * Rental package (set) arithmetic — pure, no database import, so client components can use it (see
 * src/domains/pricing/money.ts for why that matters). Batch W Amendment B, D-WB3: a set is a bundle of separate
 * machines with its own monthly price; the saving is always worked out from the machines' current single prices,
 * never typed in. Works for any appliance type, including ones the owner adds later.
 */
import { formatCents } from "@/domains/pricing/money";

export type PackageComponentPrice = { quantity: number; monthlyPriceCents: number };

export const MAX_PACKAGE_PRICE_CENTS = 10_000_000; // $100,000 — same ceiling as appliance prices
export const MAX_COMPONENT_QUANTITY = 10;

/** What the same machines would cost a month rented one by one. */
export function separateTotalCents(components: PackageComponentPrice[]): number {
  return components.reduce((sum, c) => sum + c.quantity * c.monthlyPriceCents, 0);
}

export function machineCount(components: { quantity: number }[]): number {
  return components.reduce((sum, c) => sum + c.quantity, 0);
}

/** savingCents may be zero or negative when the set price is not lower; screens then say so plainly. */
export function packageSaving(setPriceCents: number, components: PackageComponentPrice[]) {
  const separateCents = separateTotalCents(components);
  return { separateCents, savingCents: separateCents - setPriceCents };
}

/** The sentence the settings screen shows next to every set. */
export function packageSavingSentence(setPriceCents: number, components: PackageComponentPrice[]): string {
  const { separateCents, savingCents } = packageSaving(setPriceCents, components);
  const separately = `Renting these separately would be ${formatCents(separateCents)} a month; the set is ${formatCents(setPriceCents)}`;
  if (savingCents > 0) return `${separately} — the customer saves ${formatCents(savingCents)} a month.`;
  if (savingCents === 0) return `${separately} — no saving, so customers have no reason to choose the set.`;
  return `${separately} — the set costs ${formatCents(-savingCents)} more than renting them separately.`;
}

/** "Washer + Dryer", "2 × Washer + Dryer" */
export function packageContents(components: { quantity: number; name: string }[]): string {
  return components.map((c) => (c.quantity > 1 ? `${c.quantity} × ${c.name}` : c.name)).join(" + ");
}

export type PackageInput = {
  name: string;
  monthlyPriceCents: number;
  components: { applianceTypeId: string; quantity: number }[];
};

/** Plain-words problem with the input, or null when it can be saved. */
export function validatePackageInput(input: PackageInput): string | null {
  const name = input.name.trim();
  if (!name) return "Give the set a name, for example “Washer + Dryer Set”.";
  if (name.length > 100) return "Keep the name under 100 characters.";
  if (!Number.isInteger(input.monthlyPriceCents) || input.monthlyPriceCents < 0) return "Enter a monthly price of $0 or more.";
  if (input.monthlyPriceCents > MAX_PACKAGE_PRICE_CENTS) return "Enter a monthly price under $100,000.";
  const ids = input.components.map((c) => c.applianceTypeId);
  if (new Set(ids).size !== ids.length) return "Each kind of machine can be listed only once; raise its number instead.";
  if (input.components.some((c) => !Number.isInteger(c.quantity) || c.quantity < 1 || c.quantity > MAX_COMPONENT_QUANTITY)) {
    return `Each machine's number must be between 1 and ${MAX_COMPONENT_QUANTITY}.`;
  }
  if (machineCount(input.components) < 2) return "A set needs at least two machines.";
  return null;
}

/**
 * A package line takes exactly the machines the set lists — one appliance per part (W-16B). Returns a plain-words
 * problem, or null when the chosen machines match, e.g. a Washer + Dryer Set needs one washer and one dryer.
 */
export function packagePartsProblem(
  packageName: string,
  components: { applianceTypeId: string; name: string; quantity: number }[],
  chosen: { applianceTypeId: string; name: string }[],
): string | null {
  const counts = new Map<string, number>();
  for (const machine of chosen) counts.set(machine.applianceTypeId, (counts.get(machine.applianceTypeId) ?? 0) + 1);
  const matches =
    components.every((c) => counts.get(c.applianceTypeId) === c.quantity) &&
    [...counts.keys()].every((id) => components.some((c) => c.applianceTypeId === id));
  if (matches) return null;
  const picked = new Map<string, { name: string; quantity: number }>();
  for (const machine of chosen) {
    const entry = picked.get(machine.applianceTypeId) ?? { name: machine.name, quantity: 0 };
    entry.quantity += 1;
    picked.set(machine.applianceTypeId, entry);
  }
  const pickedText = picked.size ? packageContents([...picked.values()]) : "nothing";
  return `${packageName} needs exactly ${packageContents(components)}. You picked ${pickedText}.`;
}
