import "server-only";
import { readCustomerLanguage } from "./index";
import { displayCustomerLanguage } from "./review";

export async function portalLanguage(userId: string) {
  return displayCustomerLanguage(await readCustomerLanguage(userId));
}
