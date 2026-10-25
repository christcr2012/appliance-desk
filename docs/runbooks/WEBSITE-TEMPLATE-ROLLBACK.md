# Website layout (template) change and rollback

Plain-English purpose: the owner's website words, pictures and promotions are stored separately from the page layout
(the "template"). This runbook says how a layout change is made safely and how to go back if it goes wrong.
The written agreement between the two is `src/domains/site-content/template-contract.ts`.

## What protects the owner's content

- **The contract lists every place the layout shows owner content** (204 items today), with its kind and length limit.
  `tests/vc5-template-contract.test.ts` fails if the list and the editor ever disagree, in either direction.
- **Every place that shows information has exactly one owner**: the editor, one other part of the product
  (phone and email from Settings, prices from the price list, and so on), or nobody (structure such as landmarks).
- **A fingerprint of the list is committed.** Changing any slot fails the same test until `CONTRACT_FINGERPRINT` is
  updated on purpose. That failure is the prompt to decide how existing content carries over.
- **Saved examples of every supported content format** (`tests/fixtures/site-content/schema-v1.json`, `schema-v2.json`)
  must still be read and shown by the layout. The oldest format still supported is `LAST_SUPPORTED_CONTENT_SCHEMA`.
  Dropping support for a format means removing it from `SUPPORTED_CONTENT_SCHEMAS` deliberately, after every stored
  revision has been migrated by an additive, reviewed migration.
- **`planCompatibility()` is the carry-over plan.** It reports what is renamed, retired (kept aside, never deleted),
  newly required (the starting wording shows; nothing is invented over written content), and what cannot be converted
  (a person decides). It never edits a published revision.

## Making a layout change

1. Change the layout and, if it adds, removes or renames an owner-editable item, update the item in the editor registry
   (`fields.ts` / `fields-public.ts`) **and** the matching row in `CONTENT_SLOTS`.
2. If an item is renamed, add it to the rename list used with `planCompatibility()`; if it is removed, the content is kept
   aside in the report so a rollback brings it back.
3. Bump `SITE_TEMPLATE_VERSION` (`types.ts`) when the layout's meaning changes, and update `CONTRACT_FINGERPRINT`
   (the failing test prints what changed). Add a saved example of the new content format if the format changed.
4. Run `npx vitest run tests/vc5-template-contract.test.ts tests/public-pages-render.test.tsx` and the normal checks.
5. Merge to `main`. Nothing reaches visitors until the daily release; no manual release.

## Carry-over: signature-1 → signature-2 (ZONE-1, 2026-10-26)

- The service area page became the delivery-zone map, legend, address checker and town list; town pages show the zone.
- **Removed:** `area.cities.heading`, `area.zips.heading`, `area.empty` (kept aside as retired; a rollback brings them
  back). **Added, with starting wording:** `area.map.*`, `area.legend.heading`, `area.zone.*`, `area.check.*`,
  `area.towns.*`, `home.check.served.free`, `home.check.served.noprice`, `home.check.unknown`, `rent.zone`,
  `rent.zone.outside`, `rent.zone.cta`. New facts `{zone}`, `{price}`, `{miles}` come from Settings › Delivery zones.
- Changed starting words (only where the owner hadn't edited them): `area.intro`, `home.check.served`,
  `home.check.notyet`, `home.check.notyet.cta`, `rent.serving.body`.
- Rolling back is "Layout only": revert the PR. The checker then answers from the old city/ZIP lists again.

## Carry-over: classic-1 → signature-1 (V-1/V-2, 2026-10-17)

- The home page was recomposed (address check, highlighted heading words, numbered steps, price ticket, two-column FAQ).
- **Added, nothing renamed or removed:** ten home items, all with starting wording — `home.hero.highlight` (optional, starts
  empty), the address-check labels and answers (`home.check.*`) and `home.ticket.label`. Every published revision from
  classic-1 therefore still shows in full; the new items show their starting wording until the owner edits them.
- Nothing stored was rewritten. The content format (schema) is unchanged.
- Rolling back is the "Layout only" case below: revert the PR. The ten added items become unused and stay in history.
- The address check stores nothing and sends nothing; reverting it leaves no data behind.

## Rolling back

- **Layout only (content format unchanged):** revert the layout change on `main` (a new PR that reverses it). The owner's
  content is untouched because the layout never rewrites it.
- **A published website version is wrong:** Website → History → **Put in draft** on an earlier version, review, publish.
  Restoring never goes live by itself and is refused if that version needs a picture that was removed.
- **The layout was changed in a way that cannot show a stored format:** the release check fails before merge. If it
  somehow reached `live`, revert the PR and let the next daily release restore it; do not edit stored revisions by hand.
- Never delete or rewrite revisions to "fix" a layout problem. Retired items stay in history on purpose.
