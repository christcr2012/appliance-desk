/** W-20: how a rental line reads to the customer. A package line shows as one set with the machines in it. */
export type DisplayLine = {
  label: string;
  packageId?: string | null;
  assignments: { appliance: { assetNumber: string; applianceType: { name: string } } }[];
};

const tag = (assetNumber: string) => (assetNumber.startsWith("#") ? assetNumber : "#" + assetNumber);

export function describeRentalLine(line: DisplayLine): string {
  if (!line.packageId) return line.label;
  if (line.assignments.length === 0) return line.label;
  const parts = line.assignments.map((a) => a.appliance.applianceType.name.toLowerCase() + " " + tag(a.appliance.assetNumber));
  return line.label + " (" + parts.join(", ") + ")";
}
