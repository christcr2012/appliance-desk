"use server";

import { searchAll } from "@/domains/search";
import type { CommandChoice } from "@/lib/desk-command";

/** Existing searchAll rechecks session and job-role permissions before any database access. */
export async function commandSearchAction(raw: string): Promise<CommandChoice[]> {
  if (typeof raw !== "string" || raw.trim().length < 2) return [];
  const results = await searchAll(raw.slice(0, 100).trim());
  return [
    ...results.customers.slice(0, 5).map(customer => ({
      group: "Records" as const, label: customer.name,
      href: "/desk/customers/" + encodeURIComponent(customer.id),
      detail: customer.companyName ?? customer.email, id: customer.id,
    })),
    ...results.appliances.slice(0, 5).map(appliance => ({
      group: "Records" as const, label: appliance.assetNumber + " · " + appliance.typeName,
      href: "/desk/inventory/" + encodeURIComponent(appliance.id), id: appliance.id,
    })),
    ...results.leads.slice(0, 5).map(lead => ({
      group: "Records" as const, label: lead.contactName,
      href: "/desk/leads/" + encodeURIComponent(lead.id), id: lead.id,
    })),
    ...results.purchases.slice(0, 5).map(purchase => ({
      group: "Records" as const, label: purchase.seller,
      href: "/desk/purchases/" + encodeURIComponent(purchase.id),
      detail: purchase.purchasedOn.toISOString().slice(0, 10), id: purchase.id,
    })),
    ...results.sellers.slice(0, 5).map(seller => ({
      group: "Records" as const, label: seller.name,
      href: "/desk/suppliers/" + encodeURIComponent(seller.id), id: seller.id,
    })),
  ];
}
