# Implementation handoff

Apply the v2 brand system to the existing Robinson Appliance Rentals website and portals. This is a visual-system handoff, not authorization to deploy or change business rules.

1. Preserve routes, permissions, prices, integrations and business logic. Replace old branding intentionally in a separate reviewed change.
2. Put horizontal light/dark SVGs, favicon, icons and manifest under a stable /brand path. Set a meaningful logo alt label, intrinsic dimensions and appropriate responsive sizing. Do not put the full logo in a favicon.
3. Import brand.css and load the included Manrope web font. Use brand-tokens.json as the color source. Add semantic error/warning/success states with text labels; do not reuse a decorative green accent for every state.
4. Persist the visitor's light/dark choice, fall back to their system preference, and avoid theme flash. The static preview uses a toggle only; implement persistence in the app.
5. Keep the public site welcoming: ivory surfaces, evergreen headers, readable text, fresh-green accents and one dominant next action. Show actual products and truthful availability.
6. Keep owner/customer portals calm: page title, one primary action, searchable data, consistent forms, useful empty/error/loading states. Never encode status by color alone.
7. Use outlined logo masters. Template live text is for marketing edits, not logo regeneration. Header logo width should preserve the descriptor; use the standalone mark only when the business name is already present nearby.
8. Apply the favicon, social-share image, manifest and email brand. Set accurate metadata and structured data from verified business information; do not invent reviews, ratings, addresses or service areas.
9. Check mobile, zoom, keyboard focus, contrast, long names, empty states and real content. Theme tokens are starting values, not an assertion that the entire application is accessible.
10. Present the completed preview before production deployment. Record branding version 2.0 in project documentation.

The included web preview demonstrates appearance; it does not implement bookings, pricing, inventory, accounts or messaging. No live website has been modified by this kit.
