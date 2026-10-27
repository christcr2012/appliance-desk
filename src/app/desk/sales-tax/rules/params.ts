import { z } from "zod";
import { isRuleKey, type RuleArea, type RuleKey } from "@/domains/rules/registry";

const AREAS: RuleArea[] = ["SALES_TAX", "USE_TAX", "RDF", "FEDERAL", "RECORDS", "LEASES", "PROPERTY_TAX"];

const Params = z.object({
  q: z.string().trim().optional(),
  area: z.string().optional(),
  history: z.string().optional(),
  change: z.string().optional(),
});

export type RulesPageParams = {
  q: string;
  areas: RuleArea[];
  historyKey: RuleKey | null;
  changeKey: RuleKey | null;
};

/** The list state lives in the URL (KIT 5.1); an unknown key or area is ignored, never an error page. */
export function parseRulesParams(search: Record<string, string | string[] | undefined>): RulesPageParams {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string") flat[key] = value;
    else if (Array.isArray(value) && typeof value[0] === "string") flat[key] = value[0];
  }
  const parsed = Params.parse(flat);
  const areas = (parsed.area ?? "").split(",").filter((area): area is RuleArea =>
    (AREAS as string[]).includes(area));
  return {
    q: parsed.q ?? "",
    areas,
    historyKey: parsed.history && isRuleKey(parsed.history) ? parsed.history : null,
    changeKey: parsed.change && isRuleKey(parsed.change) ? parsed.change : null,
  };
}

export const RULE_AREA_OPTIONS = [
  { value: "SALES_TAX", label: "Sales tax" },
  { value: "USE_TAX", label: "Use tax" },
  { value: "RDF", label: "Delivery fee" },
  { value: "FEDERAL", label: "Federal" },
  { value: "RECORDS", label: "Records" },
  { value: "LEASES", label: "Leases" },
  { value: "PROPERTY_TAX", label: "Property tax" },
] as const;
