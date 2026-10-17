# Official Colorado forms

Blank official forms, one file per year, named `DR0252_<year>.pdf` (Consumer Use Tax Return). The app picks the form
whose year matches the return's period end, so keep older years: a 2026 return filed in January 2027 still needs the 2026 form.

**Adding a new year:** save the new official blank PDF here as `DR0252_<year>.pdf` and commit it. Nothing else changes.
In December the Taxes screens' System health raises "the next DR 0252 form isn't loaded" until it is there.
If Colorado redesigns the form, `fillDr0252` refuses to fill it (it checks every field name first) and the page shows the
line-by-line numbers instead; update the field names in `src/domains/tax/dr0252-form.ts` for the new layout.
Source: https://tax.colorado.gov (Forms, DR 0252). Added 2026-10-17 by the owner (form dated 07/06/26).
