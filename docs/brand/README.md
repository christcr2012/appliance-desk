# Brand kit v2.0 ("Evergreen") — source of truth for how the brand looks

This folder is the complete Evergreen brand kit Chris commissioned and
delivered 2026-09-29, checked in verbatim on 2026-09-30 so every AI or
person styling a screen, email, or document works from the same files
instead of guessing from the six exports under `public/brand/`.

Start with `00_Start_Here/START-HERE.md` and `Brand-Standards-v2.0.pdf`.
`Brand-Kit-Index.html` is a visual catalog of every asset.

## What to use for what

| Need | File | Notes |
| --- | --- | --- |
| Official colors, fonts, radii, spacing | `03_Design_System/brand-tokens.json` | The only place a brand color is defined. Light and dark palettes included. |
| Ready-made CSS variables | `07_Web_Email/brand.css` | Same values as the tokens file. |
| Web font | `07_Web_Email/fonts/Manrope-*.ttf`, `Manrope-Variable.woff` | Licensed under the SIL Open Font License (`fonts/OFL.txt`). |
| Logo on light backgrounds | `01_Logos/horizontal/Robinson-horizontal-light.svg` | Already copied to `public/brand/logo-light.svg`. |
| Logo on dark/evergreen backgrounds | `01_Logos/horizontal/Robinson-horizontal-dark.svg` | Already `public/brand/logo-dark.svg`. |
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

## What is deliberately not in this folder

`10_Concept_Visualization/` (an AI-generated concept board marked "NOT
production") was left out to avoid anyone mistaking it for artwork.
Everything else from the delivered zip is here unchanged; `00_Start_Here/
SHA256SUMS.txt` lets you verify that.
