# AR-6b — Equipment area: purchases and orders, parts, suppliers pages

Build spec: `docs/build-specs/screens/EQUIPMENT.md` sections 5–7 (everything is decided there). This is the
follow-on half of **AR-6** (fleet, appliance record, retired — merged PR #797): the AR-6 card's ~1,500-line split
rule was invoked at AR-6 packet time, and AR-6 landed the section 1 domain fixes these pages build over
(role-checked reads, `purchaseReceiptTotalCents`, the role-shaped `getPartsList`). Depends on **AR-6** (merged).
Risk: **the `/desk/purchase-orders` list URL becomes a redirect; the parts panels' staff behavior changes**.
No migration.

## Why
The Purchases list is still offset-paged over the old `listPurchases` options, the Purchases page still adds the
receipt total up in its JSX (the one call site AR-6's `purchaseReceiptTotalCents` move left), purchase orders load
everything with their lines, show the raw status code and compute their total in the page, the Parts page still
reads every part plus the separate low-stock list and renders the OWNER/ADMIN-only selling/stock panels for
everyone (staff get forms that always fail), and Suppliers loads everything unbounded.

## One PR
The three page areas share the orders read (`getPurchaseOrdersPage`), the cursor-converted `listPurchases`
(supplier record tabs consume both), the purchases URL's two views and the shared order words
(`PURCHASE_ORDER_PILL`). Expected size is reviewable; the pages are restyles over existing actions — nothing
here changes a purchasing rule.

## Acceptance
- [ ] Purchases: `StatusTabs` "Appliance purchases" / "Parts orders" (`?view=orders`); the purchases view runs on
      the cursor-converted `listPurchases` (sort `purchasedOn desc, createdAt desc, id desc`), seller-name/receipt
      search, the Seller filter, rows showing the domain receipt total and the "Tax question" chip; the orders
      view renders `getPurchaseOrdersPage` (open = DRAFT/ORDERED default, received, cancelled; supplier filter;
      known total computed in the domain) with `PURCHASE_ORDER_PILL` and Denver dates.
- [ ] `/desk/purchase-orders` redirects to `/desk/purchases?view=orders`; its record and new pages keep their
      URLs; the order record's header pill and dates use the shared words and Denver dates; the supplier record's
      Orders tab consumes `getPurchaseOrdersPage({ supplierId })`.
- [ ] Parts page on `getPartsList`: tabs in-stock (default) / low / archived, search, type filter, cursor;
      cards per spec; OWNER/ADMIN see "Reorder at", "Selling" and the ⋯ panels (Adjust stock… / Selling… /
      Archive-Restore, existing panels in Sheets); staff see the stock count and the low-stock pill only — no
      price keys reach their rows and no edit controls render. Record adds a finance-only header (stock and
      average cost) over the existing movement history.
- [ ] Suppliers: `getSuppliersPage` cursor list (name asc, id asc; active default / archived; search
      name/contact) with "{n} orders" rows; the record gains Purchases / Orders / Details tabs over the paged
      reads; archive moves into the ⋯ behind "Archive {name}? You can restore it later."
- [ ] Retirement of replaced reads (`getPurchaseOrders`, `getAllPartRecords` on the pages, offset
      `listPurchases`) with every caller and fixture updated in the same PR.
- [ ] Axe, five sizes, light/dark, keyboard on the rebuilt lists (browser spec); the staff Parts-without-prices
      browser case lands here (it rode from AR-6); registry entries stay truthful (kind "list" only for
      DataTable pages).
- [ ] `ci` green at the exact head; every review comment read.

## Drift found at packet time (Step 0, 2026-10-31)
- The order record's "back" target moves to `/desk/purchases?view=orders` with the list URL (its panels and
  URLs are otherwise untouched).
- The Purchases page's inline receipt-total sum is the last page-side money sum in this area; the AR-6 card's
  "three inline sums replaced" left this list call site — the cursor conversion lands it on
  `receiptTotalCents` here.
- Spec §6 puts the staff Parts browser case in §9's single `e2e/equipment.spec.ts` run; AR-6 shipped the owner
  and staff-record cases there — the Parts cases append to that file (its header already names AR-6b as their
  home).
- The supplier record's orders currently arrive embedded in `getSupplierById` (every order with every line);
  the Orders tab switches to `getPurchaseOrdersPage({ supplierId })` and the embed is dropped — the same list
  the record's totals came from, now cursor-paged.
- `getLowStockParts` keeps its other callers (the To do surface and tests) — only the Parts page stops calling
  it; `getPartsList`'s SQL rule is already its twin.
