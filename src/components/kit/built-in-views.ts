// AR-12: starter list views are honest links: pending choices never appear until that list parses the filter.
import type { ViewDef } from "./toolbar";

export type ListKey = "billing" | "customers" | "rentals" | "inventory" | "jobs" | "leads";
export type BuiltInView = {
  id: string; label: string; params: Record<string, string>;
  pending?: boolean; roles?: readonly ("OWNER" | "ADMIN" | "STAFF")[]; feature?: "propertyManagers";
};
export const BUILT_IN_VIEWS: Record<ListKey, BuiltInView[]> = {
  billing: [
    { id:"past-due", label:"Past due", params:{status:"past-due"} },
    { id:"due-this-month", label:"Due this month", params:{status:"open",due:"this-month"} },
    { id:"autopay-off", label:"Autopay off", params:{status:"open",autopay:"off"} },
  ],
  customers: [
    { id:"renting-now", label:"Renting now", params:{status:"active"} },
    { id:"owe-money", label:"Owe money", params:{owes:"yes"}, pending:true },
    { id:"property-managers", label:"Property managers", params:{kind:"pm"}, feature:"propertyManagers" },
  ],
  rentals: [
    { id:"starting-this-week", label:"Starting this week", params:{starts:"this-week"}, pending:true },
    { id:"ending-this-month", label:"Ending this month", params:{ends:"this-month"}, pending:true },
    { id:"waiting-signature", label:"Waiting for signature", params:{status:"awaiting-signature"}, pending:true },
  ],
  inventory: [
    { id:"ready-to-rent", label:"Ready to rent", params:{status:"AVAILABLE"} },
    { id:"needs-repair", label:"Needs repair", params:{status:"MAINTENANCE"} },
    { id:"out-with-customers", label:"Out with customers", params:{status:"RENTED"} },
    { id:"coming-back", label:"Coming back", params:{status:"AWAITING_PICKUP"} },
  ],
  jobs: [
    { id:"my-visits-today", label:"My visits today", params:{when:"today",who:"me"}, pending:true, roles:["OWNER","ADMIN","STAFF"] },
    { id:"not-scheduled", label:"Not scheduled", params:{when:"none"}, pending:true },
  ],
  leads: [
    { id:"new", label:"New", params:{stage:"new"}, pending:true },
    { id:"follow-up-today", label:"Follow up today", params:{follow:"today"}, pending:true },
  ],
};
export const LIST_HREF: Record<ListKey,string> = {
  billing:"/desk/billing", customers:"/desk/customers", rentals:"/desk/agreements",
  inventory:"/desk/inventory", jobs:"/desk/jobs", leads:"/desk/leads",
};
/** No promise of a view until the server actually understands every param. */
export function builtInViewsFor(key: ListKey, options: {
  role?: "OWNER" | "ADMIN" | "STAFF";
  shownFeatures?: ReadonlySet<string>;
} = {}): ViewDef[] {
  return BUILT_IN_VIEWS[key].filter(v =>
    !v.pending && (!v.roles || (options.role && v.roles.includes(options.role))) &&
    (!v.feature || options.shownFeatures?.has(v.feature))
  ).map(v => ({
    id:v.id, label:v.label,
    href: LIST_HREF[key]+"?"+new URLSearchParams(v.params).toString(), builtIn:true,
  }));
}
