# Colorado filing channels: where each return is filed and paid

Written for W-10 (2026-10-17). Sources are official Colorado Department of Revenue pages, read on the dates shown. Nothing in the app files or pays a return; the owner presses the final button on the official site (D-WA2).

| Return | Where it is filed and paid | Source |
|---|---|---|
| Sales tax (state and state-collected cities/counties) | Colorado Sales and Use Tax System (SUTS), https://suts.blt.govos.com/login | https://tax.colorado.gov/SUTS-info (checked 2026-10-16) |
| Consumer use tax (DR 0252) | Revenue Online, https://www.colorado.gov/RevenueOnline, or the paper DR 0252 by mail | DR 0252 instructions, https://tax.colorado.gov/sites/tax/files/documents/DR0252_2024.pdf (checked 2026-10-17) |
| Retail delivery fee | Colorado Department of Revenue website | Existing T-batch design |

## Consumer use tax (DR 0252): what the app shows and in what order

The use-tax return page's **File now** panel follows the lines of the state's DR 0252 form, because the Revenue Online screens ask for the same values. Revenue Online itself needs a sign-in, so its exact screen names could not be read from the build environment; the order below is the form's. The owner should confirm the screen order on the first real filing and tell us if the website differs (it is then corrected here and in `src/domains/tax/use-tax-file-now.ts`).

1. Who and when: account name, account number, period covered as MM/YY-MM/YY.
2. Line 1, taxable amount (total purchases); line 2a, purchases on which tax was already paid (zero here: those purchases are not on the return); line 2b, line 1 minus 2a.
3. Line 3, tax rate for each area; line 4, credit for tax paid to another state (zero unless the owner paid tax elsewhere on the same item); line 5, net tax due.
4. Lines 6 and 7, penalty and interest (zero when on time; when late, use the amounts the website shows); line 9, total amount owed.
5. Submit and pay on the website, then record the confirmation number with "I filed and paid it".

## Filing facts from the form instructions (DR 0252, checked 2026-10-17)

- File and pay online at Colorado.gov/RevenueOnline. Any regional transportation (RTA) consumer use tax is included with the electronic return, so DR 0251 is not needed.
- Paper filing is only for people who cannot file online: complete the whole form, include payment, mail to Colorado Department of Revenue, Denver, CO 80261-0013, and keep a copy.
- Amended returns can only be filed on paper with the amended box checked, one per period, with every line shown as corrected.
- The form has a signature under penalty of perjury; the app never signs for the owner.

## Printing the official form

"Print the filled-in official form" fills the bundled blank DR 0252 for the return's tax year (`src/domains/tax/forms/DR0252_<year>.pdf`; the 2026 form, dated 07/06/26, was supplied by the owner on 2026-10-17). Only the State column is filled, in whole dollars; the CD, RTD and ECD columns, signature, FEIN/SSN and address stay blank. To add a year, save the new official blank as `DR0252_<year>.pdf` in that folder (see its README); System health asks for it from December. If the form's field names change the app refuses to fill it and the page shows the numbers instead.
