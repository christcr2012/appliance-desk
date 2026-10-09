# Startup banking and QuickBooks evidence — October 8, 2026

Research for [K-CASH](../designs/BATCH-K-CASH.md). Public US product documentation checked October 8.
These are dated observations, not stored rates or account-opening approval. All rates are variable; confirm fees,
eligibility, cash limits and the exact QuickBooks tenant before opening. No institution guarantees approval.
Bank-feed support and a bank's OAuth app integration are different capabilities.

## Recommendation and comparison

Start with **one Bluevine Standard operating checking account + QuickBooks Online Free + Appliance Desk virtual
envelopes**, subject to the onboarding proof below. Prefer **Axos Basic** if the owner prefers a direct bank or
Bluevine onboarding/feed fails. Do not select paid tiers to earn a slightly higher yield.
Relay Starter is the later alternative for real account separation; Novo is a useful single-account bucket alternative
without interest; Mercury is not the yield recommendation for this new single-member rental LLC.

| Product | Dated cost/yield evidence | Startup fit and tradeoff | QuickBooks evidence and limit |
|---|---|---|---|
| Bluevine Standard | $0 monthly; 1.3% APY up to $250,000 only in qualifying months | LLCs supported; no minimum balance/credit score listed for checking. 5 optional separately numbered subaccounts. Fintech through Coastal Community Bank; cash deposits have fees. | Official help distinguishes primary-account QBO banking connection from bill/payee OAuth integration; subaccount payment sync unsupported. Test primary feed through QBO Free's banking screen; do not activate bank bill-sync app. |
| Axos Basic Business Checking | No monthly maintenance, opening deposit or minimum balance requirement; Basic page does not promise interest | Direct FDIC-member bank; marketed for new businesses, not a credit application. Formation/identity verification applies. | Product page explicitly supports QuickBooks syncing; exact Free-tenant connection still needs proof. |
| Relay Starter | $0 monthly; savings 1.19% APY; 20 checking and 2 savings accounts | Specifically targets new businesses and cash-envelope methods. Fintech through Thread Bank. Multiaccount maintenance conflicts with a one-connected-account software budget. | Official QBO banking setup selects individual checking/savings accounts. Help articles conflict on debit-card detail coverage; never promise complete card ingestion until a real debit purchase appears and ties to the statement. |
| Novo checking | $0 monthly/minimum; checking/Reserves do not earn interest | Reserves are virtual portions of ONE account, not new accounts. No direct cash deposits. Fintech through Middlesex Federal Savings. | Official pages describe QBO banking feed and a separate Novo app integration. Novo CSV help warns its raw download is not QBO-ready: normalize approved columns rather than upload blindly. |
| Mercury business banking | Basic banking has no monthly minimum/overdraft fee; free ACH/domestic wires | Supports formed LLCs, including planned US operations; no direct cash deposits. Fintech through partner banks. | Official FAQ supports QBO bank-feed connections. Treasury is not an ordinary savings account; $250,000 eligibility threshold and single-member LLC exclusion in current help make it unsuitable here. |
| Live Oak business savings (later) | 2.75% APY, no monthly maintenance or minimum opening deposit | Direct bank; useful once idle reserves justify a second account. Transfers/availability must be planned around tax due dates. | Bank documents QBO connectivity for checking, but this research did not establish the current savings-specific Free connector. Use manual statement/CSV route and verify savings feed separately; not advertised as fully proven. |

### Why interest does not decide the launch bank

Bluevine Standard requires $500 settled qualifying card spending OR $2,500 settled customer payments each eligibility
period; owner transfers and cash deposits do not qualify. Otherwise that month's APY is zero. Do not spend to qualify.
At a constant hypothetical $5,000 balance, 1.3% is about $65/year; 2.75% is about $137.50/year. That $72.50 difference
does not justify $456/year of software just to connect a second account. Examples assume unchanged rates/balances,
before taxes and fees, not forecasts. Physical separation may still justify extra effort on safety grounds.

Bluevine Green Dot cash deposits cost $4.95 per deposit; Allpoint+ deposits cost $1 + 0.5%. These are not free cash
handling. If cash becomes routine, compare an actual nearby Colorado bank/credit-union cash schedule before adding a
second account. Do not route business cash through personal banking to bypass fees.

## QuickBooks facts relevant to the approved architecture

QuickBooks Free is ongoing $0, with one user, one connected bank account, basic P&L/balance reports, no accountant
access, and no third-party app integrations. Intuit's journal-import and standard reconcile help pages list Free.
Manual bank-upload help also lists Free. This establishes documented eligibility, not a successful owner-tenant test.
AI reconciliation is a different paid capability and is unnecessary for this design.

Use QBO Banking -> Connect account, not the bank dashboard's third-party bill/accounting OAuth app.
Do not assume one bank login permits many connected subaccounts on Free. Start with one checking account.
Extra manually maintained accounts may be possible, but the design does not promise that Free permits every
multiaccount workflow until proven. Upgrade only after owner approves a demonstrated need: more feeds, accountant
access or an accepted API integration; never automatically.

K sends journals, not customer invoices. Export/detail and matching proof are mandatory.
A downloaded transaction should MATCH an imported entry, not ADD a duplicate income/expense.
The existing generic Appliance Desk money-movement CSV is not the K journal CSV.

## Owner setup and verification — no production automation

1. Finish Colorado formation, then obtain EIN using exact legal name. Gather formation certificate/articles, IRS EIN
letter, owner/controller ID, residential and actual operating address, business phone/email and honest expected
activity. A registered-agent address alone is not an operating address. No past revenue is promised or fabricated.
2. Apply personally on the institution's official site. Published checking requirements above do not impose a
business operating-history minimum; underwriters may ask follow-ups. Do not confuse lending criteria with checking.
3. Select Standard/Basic/Starter without paid trial auto-upgrade, overdraft/credit product or automatic bill payment.
Save current fee schedule and agreement privately. No SSN/EIN/full account number in repo, logs or app.
4. Open QBO Free for the same LLC. Confirm Chart of Accounts, journal CSV import, standard Reconcile and bank uploads
are actually present. Search for bank via QBO Banking and select ONLY the operating account.
5. Confirm statement/PDF download and settled CSV download, correct account identity, actual debit-card coverage,
ACH/check fees/holds, support and how to recover a failed feed. Bank's advertised integration alone is insufficient.
6. With sanitized isolated accounting fixtures, import K's sample journals: contribution, rental receipt/tax,
gross Stripe receipt plus fee/payout, bank expense, deposit/refund, tax payment, transfer and interest. Import bank
activity; MATCH without duplicate posting. Verify a zero-difference statement, P&L/tax/clearing and unchanged results
on repeat. On the real account, use only genuine transactions and owner-confirmed imports, never test customers.
7. Mark evidence verified in app setup only after the owner records actual result; date, software edition, account
last four, period and private evidence. If a menu/feed fails, use normalized CSV/manual reconciliation; if no workable
Free path exists, compare paid Simple Start or another accounting tool before spending.
8. Connect the bank in Stripe's own dashboard only under existing live gates. Confirm legal account holder/currency,
payout schedule, settlement delay and fees. A Stripe payout status is not proof that a bank credit cleared.

## Primary-source register

Each link was retrieved/search-verified October 8, 2026. Keep these URLs and recheck at implementation/onboarding;
the rates and product limitations above must never become financial calculation constants.

- QB1 [Free product](https://quickbooks.intuit.com/online/free/) and [US plans/limitations](https://quickbooks.intuit.com/pricing/).
- QB2 [Journal CSV import](https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/import-journal-entries-quickbooks-online/L4tQBwbs7_US_en_US).
- QB3 [Standard reconciliation](https://quickbooks.intuit.com/learn-support/en-us/help-article/statement-reconciliation/reconcile-account-quickbooks-online/L3XzsllsK_US_en_US).
- QB4 [Connect bank accounts](https://quickbooks.intuit.com/learn-support/en-us/help-article/banking/connect-bank-credit-card-accounts-quickbooks/L4yDAHMNH_US_en_US).
- QB5 [Manual transaction import](https://quickbooks.intuit.com/learn-support/en-us/help-article/import-transactions/manually-upload-transactions-quickbooks-online/L0rE9OXBz_US_en_US).
- QB6 [Match vs categorize](https://quickbooks.intuit.com/learn-support/en-us/help-article/banking/categorize-match-online-bank-transactions-online/L1bTafTz3_US_en_US).
- BV1 [Checking terms/features](https://www.bluevine.com/business-checking), [plans](https://www.bluevine.com/business-checking/plans-and-pricing), [interest qualification](https://www.bluevine.com/checking-interest).
- BV2 [QBO connection distinction](https://support.bluevine.com/s/article/How-do-I-connect-QuickBooks-to-my-Bluevine-dashboard), [sync scope](https://support.bluevine.com/s/article/What-information-does-QuickBooks-and-Bluevine-sync).
- BV3 [Checking application](https://support.bluevine.com/s/article/How-do-I-apply-for-a-Bluevine-Business-Checking-Account), [deposit agreement/fees](https://www.bluevine.com/ccbx-checking-agreement).
- AX1 [Axos Basic](https://www.axosbank.com/business/business-checking-accounts/basic-business-checking), [new business](https://www.axosbank.com/business/solutions/new-business), [documents](https://www.axosbank.com/business/support/faqs).
- RE1 [Relay pricing](https://relayfi.com/pricing/), [Starter](https://relayfi.com/hc/en-us/articles/35672368525972-Overview-of-the-Starter-Plan/), [opening](https://relayfi.com/hc/en-us/articles/38050807932436-How-to-Open-a-Relay-Business-Account/).
- RE2 [Relay bank feed](https://relayfi.com/hc/en-us/articles/360038319332-Integrating-with-QuickBooks-for-Bank-Feeds/), [integration marketing](https://relayfi.com/integrations/quickbooks/).
- NO1 [Novo account](https://www.novo.co/business-checking/online), [Reserves](https://www.novo.co/business-checking/sub-accounts), [no interest](https://novo.zendesk.com/hc/en-us/articles/45011571776916-About-Novo).
- NO2 [Novo QBO](https://novo.zendesk.com/hc/en-us/articles/360022600271-Does-Novo-integrate-with-QuickBooks), [CSV caveat](https://novo.zendesk.com/hc/en-us/articles/360053999832-How-do-I-download-my-transaction-history-as-a-CSV-file).
- ME1 [Mercury FAQ](https://mercury.com/faq), [pricing](https://support.mercury.com/hc/en-us/articles/28769703794580-Mercury-pricing-plans), [Treasury eligibility](https://support.mercury.com/hc/en-us/articles/41673479637908-Qualifying-for-a-Treasury-account).
- LO1 [Live Oak savings](https://www.liveoak.bank/business-savings/), [checking/QBO](https://www.liveoak.bank/business-checking/).
- ST1 [Stripe bank setup](https://support.stripe.com/questions/add-a-bank-account-for-payouts), [payout transactions](https://docs.stripe.com/api/balance_transactions/list).
- IRS1 [EIN/entity order](https://www.irs.gov/businesses/employer-identification-number).

No account was opened; no feed, APY eligibility, customer charge, bank transfer, software subscription or API
authorization was activated by this research. Public compatibility is documented; tenant-level verification is pending.

## Budgeting examples and design evidence

Checked October 8, 2026. YNAB documents planning with existing cash while scheduled transactions and targets describe
future needs. Its small-business guide recommends keeping business planning separate and aligning categories with
accounting. Actual Budget documents envelope carryover and separates real available funds from income predictions.
These support the cash-vs-forecast boundary; our tax liability, journal, provider and permission rules remain
Appliance Desk's own contracts.

K-CASH adopts three easy target types: monthly spending capacity, save by a date, and maintain a reserve balance.
Known bills have separate scheduled occurrences with actual-payment links. A yearly license/insurance expense can be
funded gradually; targets and its scheduled bill are combined using the larger need rather than added twice.
Funding previews prioritize dated obligations, show shortages, and require owner confirmation. Targets are not
payments; occurrence generation never posts expense, sends money or marks an invoice paid.

- BG1 [YNAB future income](https://support.ynab.com/en_us/assigning-future-income-an-overview-BJsTo0jCq).
- BG2 [YNAB target overview](https://support.ynab.com/en_us/getting-started-with-targets-ryAEP08xC).
- BG3 [YNAB underfunded preview](https://support.ynab.com/en_us/underfunded-a-guide-BJwPhQO09).
- BG4 [YNAB business plan](https://support.ynab.com/en_us/how-to-set-up-a-small-business-plan-rJ483f2Qh).
- BG5 [YNAB sinking funds](https://www.ynab.com/blog/what-is-a-sinking-fund).
- BG6 [Actual envelope budgeting](https://actualbudget.org/docs/getting-started/envelope-budgeting/).
- BG7 [Actual budget mechanics](https://actualbudget.org/docs/budgeting/).

### Reporting examples

Actual's official reports dashboard illustrates cash-flow, net-worth and spending-analysis views with filtered date
ranges and transaction analysis. K-CASH adopts fixed business trend, spending and cash views plus immutable plan
comparisons. It does not copy experimental simulations or rely on another product's accounting classification.
Appliance Desk reports stay available independently of the selected QuickBooks edition.

- RP1 [Actual reports dashboard](https://actualbudget.org/docs/reports/).
