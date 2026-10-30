// AR-12: starter list views are honest links: pending choices never appear until that list parses the filter.
import type { ViewDef } from "./toolbar";

export type ListKey = "billing" | "customers" | "rentals" | "inventory" | "jobs" | "visits" | "leads";
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
    { id:"renting-now", label:"Renting now", params:{segment:"active"} },
    { id:"owe-money", label:"Owe money", params:{segment:"owes"}, roles:["OWNER","ADMIN"] },
    { id:"property-managers", label:"Property managers", params:{pm:"1"}, feature:"propertyManagers" },
  ],
  rentals: [
    { id:"starting-this-week", label:"Starting this week", params:{starts:"this-week"} },
    { id:"ending-this-month", label:"Ending this month", params:{ends:"this-month"} },
    { id:"waiting-signature", label:"Waiting for signature", params:{status:"signing"} },
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
  visits: [
    { id:"my-visits-this-week", label:"My visits this week", params:{status:"upcoming",who:"mine",when:"this-week"}, roles:["OWNER","ADMIN"] },
    { id:"pickups-to-book", label:"Pickups to book", params:{status:"no-time",type:"pickup"} },
    { id:"repairs-not-finished", label:"Repairs not finished", params:{status:"upcoming",type:"repair"} },
  ],
  leads: [
    { id:"new", label:"New", params:{stage:"new"} },
    { id:"follow-up-today", label:"Follow up today", params:{follow:"today"} },
    { id:"my-new-leads", label:"My new leads", params:{stage:"new", owner:"me"} },
    { id:"property-managers", label:"Property managers", params:{pm:"1"}, feature:"propertyManagers" },
  ],
};
export const LIST_HREF: Record<ListKey,string> = {
  billing:"/desk/billing", customers:"/desk/customers", rentals:"/desk/agreements",
  inventory:"/desk/inventory", jobs:"/desk/jobs", visits:"/desk/jobs", leads:"/desk/leads",
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
