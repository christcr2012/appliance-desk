# Brand kit v2.0 ("Evergreen") — source of truth for how the brand looks

This folder is the production Evergreen brand kit Chris commissioned and
delivered 2026-09-29. The checked-in files are the production subset used by
this repository, not a byte-for-byte copy of every delivered concept file:
`10_Concept_Visualization/` is intentionally excluded so an AI-generated
concept board cannot be mistaken for production artwork. On 2026-10-02 the
originally empty `01_Logos/mark/Robinson-mark-light.png` export was repaired by
rendering the committed SVG master; the manifest and checksum inventory below
describe the repository state after that repair.

Start with `00_Start_Here/START-HERE.md` and `Brand-Standards-v2.0.pdf`.
`Brand-Kit-Index.html` is a visual catalog of every production asset.

## What to use for what

| Need | File | Notes |
| --- | --- | --- |
| Official colors, fonts, radii, spacing | `03_Design_System/brand-tokens.json` | The only place a brand color is defined. Light and dark palettes included. |
| Ready-made CSS variables | `07_Web_Email/brand.css` | Same values as the tokens file. |
| Web font | `07_Web_Email/fonts/Manrope-*.ttf`, `Manrope-Variable.woff` | Licensed under the SIL Open Font License (`fonts/OFL.txt`). |
| Logo on light backgrounds | `01_Logos/horizontal/Robinson-horizontal-light.svg` | Canonical two-color master. `public/brand/logo-light.svg` is not yet synchronized to this master; that app-branding update remains pending. |
| Logo on dark/evergreen backgrounds | `01_Logos/horizontal/Robinson-horizontal-dark.svg` | Canonical dark-background master. `public/brand/logo-dark.svg` is not yet synchronized to this master; that app-branding update remains pending. |
| Standalone mark | `01_Logos/mark/Robinson-mark-evergreen.svg` | Only where the business name already appears nearby. |
| Favicon, app icons, manifest | `02_Icons/` | `icon-192.png` and `icon-512.png` are already in `public/brand/`. |
| Service icons used in the desk/portal | `03_Design_System/Service-icons/` | appliance, calendar, delivery, home, property, support. |
| Transactional email layout | `07_Web_Email/Customer-email-EDITABLE.html` | `src/lib/email.ts` already implements this layout; keep them in sync. |
| Gmail / mail-client signature | `07_Web_Email/Email-signature.html` | Text-only, no hosted images. Paste into the Gmail signature editor. |
| Invoice, estimate, work-order look | `08_Business_Forms/*.pdf` | The in-app documents at `/desk/billing/...` and `/desk/jobs/[id]/work-order` follow these. |
| Social, print, vehicle, apparel templates | `04_`, `05_`, `06_` | `-EDITABLE.svg` files have live text; outlined files are for vendors. |
| Copy and messaging | `09_Handoff/Marketing-copy-and-message-bank.md` | Tagline: "Make room for everyday." |

## Rules the kit itself sets (see `09_Handoff/Website-and-Claude-handoff.md`)

- Colors come from `brand-tokens.json`; never hard-code a hex value elsewhere.
- Semantic states (error, warning, success) get their own colors plus a text
  label. The fresh-green accent is not a status color.
- Never encode status by color alone (matches `docs/DESIGN-SYSTEM.md`).
- The header logo keeps the "Appliance Rentals" descriptor; the bare mark is
  for places where the name is already visible.
- The kit invents no phone number, address, prices, or legal terms. Those come
  from `/desk/settings` (`BusinessSettings`), never from a template.

## Integrity and deliberate omissions

`10_Concept_Visualization/` is deliberately not checked in. The repaired
light-mark PNG is derived from its checked-in SVG master. `00_Start_Here/
Asset-manifest.csv` and `00_Start_Here/SHA256SUMS.txt` list only files that are
actually present in this production subset; CI verifies both inventories so a
missing, empty, or mismatched asset fails before merge.
