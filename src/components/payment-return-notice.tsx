import type { CustomerLanguage } from "@/domains/language/copy";
import { portalLabel } from "@/domains/language/portal-copy";
export function PaymentReturnNotice({language,state}:{language:CustomerLanguage;state?:string}) {
  if (!["success","processing","cancelled"].includes(state ?? "")) return null;
  return <p role="status" className="my-4 rounded-card border border-line bg-subtle p-4 text-sm">
    {portalLabel(language,state === "cancelled"
      ? "Payment was not completed. Contact the business before starting another payment if its status is uncertain."
      : "Payment returned for verification. A redirect does not confirm payment.")}
  </p>;
}
