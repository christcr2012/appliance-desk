import "server-only";
import { displayCustomerLanguage } from "./review";
/** Public credential UI never trusts the query as permission to publish Spanish. */
export async function authPageLanguage(requested?:string) {
 return displayCustomerLanguage(requested==="es"?"es":"en");
}
