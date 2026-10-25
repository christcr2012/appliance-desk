# Operating risks a one-person rental business must handle — researched 2026-10-25

Source for OPS units (`docs/build-specs/engines/OWNER-OPERATIONS.md`). Accessed 2026-10-25. **V** = official source read;
**U** = unverified (careful choice + Decisions question). Not legal advice.

1. **Recalls (V).** CPSC Recall API `https://www.saferproducts.gov/RestWebServices/Recall` (no key; `format=json`;
   params RecallDateStart/End, LastPublishDateStart/End, ProductName, Manufacturer, …; no model field — models are in
   Products/Description text; misspelled parameter names return everything). Live query returned JSON (e.g. Galanz
   retro refrigerators, 2026-07-30). Selling a recalled product is prohibited (15 U.S.C. 2068(a)(2)(B); CPSC resellers
   guide "It is illegal to sell any recalled product"). Retailers/distributors must report defects "within 24 hours"
   (16 CFR 1115.14). Whether **renting** is "distribution in commerce": U → careful choice: treat as covered (`OPS-RECALL-RENTAL`, attorney).
2. **Refrigerant (V).** EPA §608 safe disposal: the final processor (scrap recycler) must recover refrigerant or get a
   **signed statement** with name/address of who recovered it and the date (40 CFR 82.155), kept 3 years; people
   recovering from small appliances before disposal needn't be certified but must use certified recovery equipment
   (90%/80% recovery or 4" Hg vacuum, 82.156(b)); servicing sealed systems needs Type I certification (U here). A Greeley
   scrap yard was fined $195,000 by EPA (2024) for missing statements. Colorado rules (AQCC Reg. 15, HFC, white goods): U.
3. **Data breach (V).** C.R.S. 6-1-716: notify residents within **30 days** of determining a breach; AG too if ≥ 500
   residents; credit bureaus if > 1,000; required notice contents; encryption safe harbor. 6-1-713: written disposal
   policy; destroy personal data when no longer needed. 6-1-713.5: reasonable security; require service providers to
   keep comparable safeguards.
4. **Colorado Privacy Act (V).** Applies over 100,000 consumers or 25,000 + data sales → not applicable (inference).
   Biometric identifiers (HB24-1130, from 2025-07-01) may apply regardless (U) → don't use face-match ID checks.
5. **Collections (V).** Small claims up to **$7,500**, also replevin up to $7,500 (C.R.S. 13-6-403); file where the
   defendant lives/works or the property is; max 2 claims a month and 18 a year per county; fees $31 (≤ $500) / $55
   (Judicial Branch, Jan 2025 list). Collecting one's own debt in one's own name isn't a "collection agency" (C.R.S.
   5-16-103) — never use another name. Month-to-month rentals likely aren't "consumer leases" (> 4 months, 5-1-301).
   Rent-to-own (an ownership option) would bring Article 10 caps (late fee $5, etc.) — the app offers no ownership option.
   Taking goods back after default only without breach of the peace, otherwise court (C.R.S. 4-2.5-525); meaning U.
   No late-fee cap found for plain rentals (U; Chris's $5 is at the Article 10 level anyway).
6. **Vehicle (V).** IRS 2026 business mileage **72.5¢/mile**; standard rate must be chosen in the first year to keep the
   option. No CDL below 26,001 lb GVWR; Colorado "commercial vehicle" rules from 16,001 lb (C.R.S. 42-4-235); medical card
   at 16,001–26,000 lb intrastate U.
7. **Insurance (V).** Colorado auto minimums 25/50/15 (C.R.S. 10-4-620); an LLC member owning ≥ 10% may reject workers'
   comp by sending the approved form by certified mail (C.R.S. 8-41-202); general liability/equipment cover advisable
   (no official requirement found).
8. **Disputes (V).** Stripe card disputes: respond once, deadline on the dispute (usually 7–21 days), evidence ≤ 4.5 MB
   combined, `charge.dispute.created/closed` events. ACH: consumers can dispute for 60 days (business 2 days); ACH
   disputes are final; the mandate becomes invalid; 7 days' notice before changing debit timing; give customers the
   mandate copy.
9. **Texting/email (V).** 47 CFR 64.1200: marketing texts need prior express written consent; no solicitations before
   8 am or after 9 pm; revocation by any reasonable method honored within 10 business days. Colorado no-call (C.R.S.
   6-1-903/904) covers texts; exemptions for permission, relationship within 18 months, inquiry within 30 days.
   CAN-SPAM: postal address, opt-out honored within 10 business days, penalty up to $53,088 per email.
10. **Accessibility (V).** DOJ: ADA applies to businesses' websites; WCAG as guidance. Colorado C.R.S. 24-34-802: $3,500
    per violation, 50% less for small businesses fixing within 30 days (website coverage U).
11. **Retention (V).** Contract claims 3 years (13-80-101); debts 6 years (13-80-103.5); tax 3/6/7 years; personal data
    destroyed when no longer needed.
12. **Continuity (V).** A Colorado LLC with no members dissolves on the 91st day unless a member is admitted
    (7-80-801); an executor has only assignee powers (7-80-704, 7-80-702) → nobody may be able to run the business
    without a successor-member clause in the operating agreement (attorney).
