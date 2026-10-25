# Screen spec — Equipment: fleet, the appliance record, purchases, parts, suppliers, retired

Built in **AR-6**. Design: `APP-REDESIGN.md` sections 4.1 (Equipment area), 4.2, 4C (tier 3: QR label, split,
out-of-service, tax proof become actions/tabs on the appliance record), 7 (page map). Kit: KIT.md. Navigation tabs
from NAVIGATION.md: Fleet `/desk/inventory` (all team; `/desk/fleet` matches it until AR-9 moves that report to
Equipment › Insights), Purchases `/desk/purchases` (finance; `/desk/purchase-orders` matches it), Parts
`/desk/parts` (all team), Suppliers `/desk/suppliers` (finance), Retired `/desk/inventory/retired` (finance).
Everyday words: **appliance** (a unit you own), **appliance number** (asset number), **in repair** (MAINTENANCE),
**retired**, **purchase** (a receipt for appliances), **order** (purchase order for parts), **equipment value**
(not depreciation). **No inventory rule changes** beyond the fixes in section 1: every button calls an existing
server action (`updateApplianceStatusAction`, `updateApplianceDetailsAction`, `addAppliancePhotoAction`,
`startRepairAction`, `retireApplianceAction`, `getSwapCandidatesAction`/`startSwapAction`, `recordInspectionAction`,
`markCleaningDoneAction`, `recordManualCustodyAction`, `bulkUpdateApplianceStatusAction`, `createPartRecordAction`,
`deletePartRecordAction`, the out-of-service, split and retired-plan actions, and the purchasing actions in
`src/app/desk/purchasing-actions.ts`).

## 1. Fixes found while specifying (do them in this card)

1. **Read functions without a role check** (same reason as PR #594 — layouts don't re-run on navigation):
   `getApplianceCountsByStatus`, `getAppliances`, `getAppliancesCount`, `getAppliancesPage`,
   `getPartRecordsForModel` (`src/domains/inventory/index.ts`), `getPurchaseOrders`, `getPurchaseOrderById`,
   `getSuppliers`, `getSupplierById` (`src/domains/purchasing/index.ts`), `listPurchases`, `countPurchases`,
   `getPurchaseDetail` (`src/domains/purchasing/purchases.ts`). Add `requireRole("OWNER","ADMIN","STAFF")` to the
   inventory ones (staff use the fleet list) and `requireRole("OWNER","ADMIN")` to the purchasing ones; update the
   tests that call them to provide a session (the PR #594 `vi.mock("@/lib/session", …)` pattern).
2. **Staff see money on Parts and get forms that always fail.** `/desk/parts` is open to STAFF, but it shows each
   part's retail price and average cost (`PartSaleSettings`) and stock/sale edit forms whose actions require
   OWNER/ADMIN. Fix: `getPartsList(params)` (section 6) returns a staff DTO with no `retailPriceCents`,
   `resaleCostOnHandCents`, `resaleUnitsOnHand`; the "Selling" column and the stock edit controls render only for
   OWNER/ADMIN; staff see stock count and the low-stock pill only.
3. **The plain status change and the bulk "Set status to" offer Retired.** Both call `updateApplianceStatus`, which
   allows `RETIRED` and so skips the reason that `retireAppliance` requires (and the retired plan that follows). Make
   `updateApplianceStatus` refuse `newStatus === "RETIRED"` with "Use Retire this appliance so the reason is kept."
   and drop Retired from the bulk select. The bulk select shows only statuses that at least one selected appliance can
   move to (`ALLOWED_APPLIANCE_TRANSITIONS`).
4. **Money math in the page:** the Purchases list adds `subtotalCents + sellerTaxCents + otherChargesCents` in the JSX.
   Move it to `purchaseReceiptTotalCents(purchase)` in `src/domains/purchasing/purchases.ts` (unit-tested) and select
   it in the list DTO.
5. **Raw codes / server time zone:** purchase orders show `label={order.status}` ("ORDERED") and
   `toLocaleDateString()` (list, record, supplier page); the appliance record shows `Added
   {toLocaleDateString()}`. Use `PURCHASE_ORDER_PILL` (section 7) and `formatShortDate`/`formatBusinessDate`.
6. **Unbounded reads:** `getPurchaseOrders()` loads every order with every line; `getSuppliers()` every supplier; the
   appliance record loads **every customer** (`getCustomers()`) when it needs a custody record, and up to 500 parts for
   the retired panel on every visit to a retired appliance. Fix: cursor lists (sections 5–7); the custody form uses the
   kit `SearchablePicker` backed by the existing customer search (`src/domains/search`), loading nothing up front; the
   retired panel's part picker uses the same picker over `getPartsList`.
7. **Fleet list ordering:** `getAppliancesPage` orders by `createdAt` only with offset paging, so units created in
   the same instance (a purchase creates several at once) can repeat or be skipped across pages. The cursor list sorts
   `(createdAt desc, id desc)`.
8. **Sequential reads on the appliance record:** `awayForRepair`, `openCustody`, `pendingTax`, `taxProof`,
   `retiredPlan`, salvaged parts and `custodyAddress` are awaited one after another. Run the independent ones in one
   `Promise.all` (same values).

## 2. Shared pieces

- `APPLIANCE_PILL: Record<ApplianceStatus, { label; tone }>` (`src/domains/inventory/words.ts`) using
  `APPLIANCE_STATUS_LABELS` for labels: AVAILABLE good, RESERVED info, RENTED info, AWAITING_PICKUP attention,
  AWAITING_INSPECTION attention, CLEANING attention, MAINTENANCE attention, RETIRED neutral. "Away for repair" chip
  (attention) when an open `OutOfServicePeriod` exists.
- `applianceTitle(a)` = `"{type name} #{assetNumber}"`; `applianceSubtitle(a)` = manufacturer · model · color (only
  the parts present) or "No make or model yet".
- Glossary entries: `awaiting-inspection`, `away-for-repair`, `equipment-value`, `purchase-tax-status`,
  `retired-plan`, `low-stock`.

## 3. Fleet — `/desk/inventory` (same URL)

**Params** (`src/app/desk/inventory/params.ts`): `status` = `ready` (AVAILABLE) | `out` (RENTED, RESERVED) | `coming-back`
(AWAITING_PICKUP) | `needs-work` (AWAITING_INSPECTION, CLEANING, MAINTENANCE) | `all` (default: everything except
RETIRED); `type` (appliance type slug, select from active types); `tax` = the existing purchase-tax states
(OWNER/ADMIN only; ignored for STAFF, as today); `q` (appliance number prefix, serial number exact, model contains);
`sort` = `newest` (default) | `number` (assetNumber asc) | `type`; `cursor`. Old `?status=AVAILABLE` etc. map to the
tab that contains it; `?taxStatus=` maps to `tax`; `?page=` ignored. Retired appliances live on the Retired tab.
**Data** `src/domains/inventory/fleet-list.ts`: `getFleet(params)` / `getFleetCounts(params)` (cursor rule, role check,
one `groupBy` for counts). Row: id, assetNumber, status, manufacturer, model, color, currentLocation, type name, open
out-of-service flag, and for RENTED/AWAITING_PICKUP the open custody's customer name and address city (one batched
query for the page's ids — staff see it too, as on the appliance page today).
**Layout:** `ScreenHeader` "Equipment"; primary (OWNER/ADMIN) "Record a purchase" → `/desk/purchases/new`; ⋯ "Export
CSV" (existing export route, OWNER/ADMIN). `StatusTabs` "All {n}", "Ready to rent {n}", "Out with customers {n}",
"Coming back {n}" (hide 0), "Needs work {n}" (hide 0). Toolbar search "Appliance number, serial or model", filters
Type and (OWNER/ADMIN) "Purchase tax"; sorts "Newest", "Appliance number", "Type". Built-in views (register a
`fleet` entry in AR-12's built-in views): "Ready to rent", "Needs repair", "Out with customers". Cards:
`applianceTitle` · `applianceSubtitle` · where (`"With {customer}, {city}"` / currentLocation / "At the shop") ·
pill. Desktop columns: Appliance · Make and model · Where · Status · ⋯; bulk (OWNER/ADMIN): "Change status…" (Sheet
with the allowed-status select from fix 3 → existing `bulkUpdateApplianceStatusAction`; result toast "{n} changed,
{m} skipped" and a list of skipped reasons). Row ⋯: "Open", "Print QR label" (`/desk/inventory/{id}/qr`), and
(OWNER/ADMIN) "Start a repair…" / "Retire…" (open those actions on the record). Empty: "No appliances yet" + "Record a
purchase" (OWNER/ADMIN) / "No appliances here" when filtered.

## 4. Appliance record — `/desk/inventory/[id]` (same URL)

STAFF keep `OperationalAppliance` (`getOperationalApplianceById`), restyled with `RecordHeader` + the Overview tab
only (no money, no tax). Everything below is OWNER/ADMIN; tax pieces OWNER only as today.
**Header:** back "← Fleet"; eyebrow "Appliance"; title `applianceTitle`; pills `APPLIANCE_PILL` (+ "Away for
repair"); subtitle `applianceSubtitle`; overflow ⋯: "Print QR label", "Split into separate machines" (only for the
old set type, as today, → `/desk/inventory/{id}/split`), "Edit details" (existing details panel in a Sheet).
**StatStrip:** "Status" · "Where" (custody customer and city, or location) · "Earned" (profitability total revenue,
`formatMoney`) · "Cost" (`acquisitionCostCents` or "Not entered", attention) · "In service since"
(`formatShortDate(purchaseDate ?? createdAt)`).
**Next step** (`applianceNextStep(a, extras)`, pure, `src/domains/inventory/next-step.ts`): open out-of-service →
"Return or replace it" → `/desk/inventory/{id}/out-of-service`; AWAITING_INSPECTION → "Inspect it" (opens the
existing inspection form); CLEANING → "Mark it cleaned" (form → `markCleaningDoneAction`); RENTED/AWAITING_PICKUP and
no open custody → "Record who has it" (custody Sheet with the customer picker, fix 6); `acquisitionTaxStatus ===
"UNKNOWN"` and OWNER → "Answer the purchase tax question" (scrolls to the tax tab); RETIRED with no plan or an open
plan → "Choose what happens to it" (retired tab); old set type → "Split it into separate machines"; else none.
**Action bar (primary by status, existing actions):** AVAILABLE/RESERVED → "Start a repair…"; RENTED → "Swap it…";
AWAITING_INSPECTION → "Inspect"; CLEANING → "Mark cleaned"; MAINTENANCE → "Finish repair…" (the existing
status-change options from MAINTENANCE); others none. Secondary in ⋯: "Retire…" (any non-retired status) →
**ConfirmDialog (danger)** with the required reason field: title "Retire {applianceTitle}?", summary "It can't be
rented again. You'll choose what happens to it next (sell, strip for parts, scrap or throw away). This can't be
undone." confirm "Retire it" → `retireApplianceAction` (today's form has no confirmation).
**Tabs:** "Overview" (custody panel, cleaning panel, photos, details) · "Repairs and visits" (the existing history
timeline filtered to visits and repairs, each row linking to its visit/repair) · "Money" (earnings summary, budget
context card) · "Parts" (existing `PartsSection`) · "Tax" (OWNER: purchase-tax panel and tax proof) · "Retired"
(RETIRED only: `RetiredPlanPanel`) · "Activity" (full history timeline, `RecordConnections`). Out-of-service and QR
stay their own pages (they are printing/guided screens) but are reached only from the record.

## 5. Purchases — `/desk/purchases` (same URL) with orders as a second view

`StatusTabs` (param `view`): "Appliance purchases" (default) and "Parts orders" (→ the purchase-orders list
rendered on this page; `/desk/purchase-orders` redirects to `/desk/purchases?view=orders`, its record and new pages
keep their URLs).
**Appliance purchases:** `listPurchases` gains the cursor rule (sort `purchasedOn desc, createdAt desc, id desc`);
search `q` (seller name, receipt reference); filter "Seller" (supplier select); row: date `formatShortDate(purchasedOn)`
· seller · `"{n} appliances"` · total (`purchaseReceiptTotalCents`) · attention chip "Tax question" when any of its
appliances is `UNKNOWN` (OWNER/ADMIN). Primary "Record a purchase". Record page `/desk/purchases/[id]`: `RecordHeader`
"Purchase from {seller}", StatStrip "Date" · "Receipt total" · "Seller tax" · "Appliances"; tabs "Appliances"
(rows link to each appliance), "Receipt pages", "Sales tax" (OWNER, existing `PurchaseTaxForm`).
**Parts orders:** `getPurchaseOrdersPage(params)` (cursor; `status` = `open` (DRAFT, ORDERED) default | `received` |
`cancelled`; supplier filter), selecting order id, status, supplier name, createdAt, receivedAt, line count and the
known total (sum computed in the domain, not the page). `PURCHASE_ORDER_PILL`: DRAFT "Draft" (neutral), ORDERED
"Ordered" (info), RECEIVED "Arrived" (good), CANCELLED "Cancelled" (neutral). Primary "New order" →
`/desk/purchase-orders/new`. Record page keeps its panels; header pill, dates in Denver.

## 6. Parts — `/desk/parts` (same URL)

**Params:** `status` = `in-stock` (default: not archived) | `low` (low stock) | `archived`; `q` (model number, part
number, part name contains); `type` (appliance type); `cursor` (sort `modelNumber asc, id asc`).
**Data** `getPartsList(params, actor)` in `src/domains/purchasing/parts-list.ts`: role-shaped DTO (fix 2); low-stock flag
computed in SQL with the same rule as `getLowStockParts` (`reorderThreshold IS NOT NULL AND "quantityOnHand" <= "reorderThreshold"`, so the `low` tab can page) instead of the separate `getLowStockParts()` call.
**Layout:** cards: `"{partName or 'Part ' + partNumber}"` · `"Fits {modelNumber}{ — type}"` · `"{n} on hand"` · pill
"Low stock" (attention) / "Archived" (neutral). OWNER/ADMIN desktop columns add "Reorder at", "Selling" (price or
"Not for sale"), and ⋯ "Adjust stock…", "Selling…" (the existing panels in Sheets), "Archive"/"Restore". Primary
(OWNER/ADMIN) "New order" when the low tab has rows. Record `/desk/parts/[id]`: movement history (already paged),
header with stock and (OWNER/ADMIN) average cost. Empty: "No parts logged yet. Add parts from an appliance's Parts
tab."

## 7. Suppliers — `/desk/suppliers` (same URL)

Cursor list (sort `name asc, id asc`; `status` = `active` default | `archived`; search name/contact). Row: name ·
contact person · phone (tap to call) · `"{n} orders"`. Record: `RecordHeader` with contact quick buttons; tabs
"Purchases" (`listPurchases({ supplierId })` paged), "Orders" (`getPurchaseOrdersPage({ supplierId })`), "Details"
(existing form). Archive keeps its existing button inside ⋯ with a ConfirmDialog "Archive {name}? You can restore
it later."

## 8. Retired — `/desk/inventory/retired` (same URL)

Keep its data (`listRetiredAppliances`, `countRetiredByState`, scrap payments, deposit accounts, follow-up days).
Restyle: `StatusTabs` from the existing `FILTERS` (Waiting · Sell · Strip for parts · Scrap · Throw away · Other ·
Done) with counts from `countRetiredByState`; rows `applianceTitle` · plan word · `"Retired {formatShortDate}"` ·
follow-up chip "Past {n} days" (attention) when past `getRetiredFollowUpDays()`; bulk "Mark done" (existing
`completeRetiredPlansAction`, ConfirmDialog with the done date). Scrap money stays a section below with "Record scrap
money" (Sheet, existing form). The follow-up days setting moves to Settings (AR-8) — until then it stays on this page
with the standard setting explanation ("How many days a retired appliance can wait for a decision before it shows
on To do. Starting value {current}.", restore recommended).

## 9. Tests
- Unit: `tests/appliance-words.test.ts` (pills for every status), `tests/appliance-next-step.test.ts`,
  `tests/purchase-total.test.ts`, `tests/equipment-params.test.ts` (old links map).
- Throwaway Postgres: `tests/fleet-list-integration.test.ts` (tabs, search by number/serial/model, cursor with units
  created in the same instant, custody names batched), `tests/inventory-role-checks.test.ts` (each function in fix 1
  refuses without a team session; purchasing ones refuse STAFF), `tests/parts-list-integration.test.ts` (staff DTO has
  no price/cost fields — assert the keys are absent), `tests/appliance-status-retire-guard.test.ts` (plain and bulk
  change to RETIRED refused; `retireAppliance` still works), `tests/purchase-orders-page-integration.test.ts`.
- Browser (shard): `e2e/equipment.spec.ts` — owner filters Ready to rent, opens an appliance in the side panel,
  retires one through the confirmation; staff sees Parts without prices and no edit controls; purchases view switch;
  axe + the five sizes, light/dark, keyboard.
- Add the pages to `docs/build-specs/migrated-pages.json`.
