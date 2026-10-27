import { businessDateKey } from "@/lib/business-date";

/**
 * SETUP-1: the guided walkthroughs that walk the owner through setting up
 * every real-world account the business needs (spec:
 * docs/build-specs/engines/RECORDS-VAULT.md §8). Pure data + the suggestion
 * ordering — the database side lives in guide.ts.
 *
 * A check is something the app can verify itself. Only checks with a real
 * signal are in the registry below (guide.ts implements every one, and the
 * data test fails if a walkthrough names a check that does not exist).
 * ENV_PRESENT reads a key's PRESENCE only, from a fixed allowlist — a secret
 * value is never read, shown, logged or audited.
 */

export const SETUP_ENV_ALLOWLIST = [
  "COMPLIANCE_ENCRYPTION_KEY",
  "VAULT_ENCRYPTION_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "RESEND_API_KEY",
] as const;
export type SetupEnvName = (typeof SETUP_ENV_ALLOWLIST)[number];

export type FilingAccountKind = "SALES_RETURN" | "USE_TAX_RETURN" | "RETAIL_DELIVERY_FEE_RETURN";

export type SetupCheck =
  | { type: "ENV_PRESENT"; env: SetupEnvName }
  | { type: "RECORD_EXISTS"; templateKey: string }
  | { type: "RECORD_HAS_NUMBER"; templateKey: string }
  | { type: "RECORD_HAS_FILE"; templateKey: string }
  | { type: "FILING_ACCOUNT_SET"; kind: FilingAccountKind };

export type SetupCheckType = SetupCheck["type"];

export const IMPLEMENTED_CHECK_TYPES: readonly SetupCheckType[] = [
  "ENV_PRESENT",
  "RECORD_EXISTS",
  "RECORD_HAS_NUMBER",
  "RECORD_HAS_FILE",
  "FILING_ACCOUNT_SET",
];

export type SetupStep = {
  key: string;
  title: string;
  /** Plain steps, with exact menu names where the app or a portal has them. */
  body: string;
  /** External link (always https). */
  link?: { href: string; label: string };
  /** The business record this step fills, when it produces a number or a file. */
  record?: { templateKey: string; fields: readonly ("number" | "file")[] };
  check?: SetupCheck;
};

export type Walkthrough = {
  key: string;
  title: string;
  why: string;
  /** What finishing unlocks: compliance keys or features, in plain words. */
  unlocks: readonly string[];
  /** What to have ready before starting. */
  needs: readonly string[];
  estimatedMinutes: number;
  /** A date this is needed by each year (e.g. the IRIS TCC before January 31). */
  neededBy?: { monthDay: string; label: string };
  steps: readonly SetupStep[];
};

export const WALKTHROUGHS: readonly Walkthrough[] = [
  {
    key: "business-basics",
    title: "Business basics: your LLC",
    why: "The LLC is the business itself. Its papers are what banks, the IRS and the state ask for, and the app keeps them as records with renewal reminders.",
    unlocks: ["Everything else — the EIN, bank account and licenses all build on the LLC"],
    needs: ["Your chosen business name", "A credit or debit card for the state filing fee"],
    estimatedMinutes: 30,
    steps: [
      {
        key: "form-llc",
        title: "Form the LLC with Colorado",
        body: "On the Colorado Secretary of State site, choose Business → File a form → Articles of Organization for a limited liability company. File as Robinson Appliance Rentals LLC. When the filing is accepted, note the date — the app starts your yearly periodic report reminder from the record.",
        link: { href: "https://www.sos.state.co.us/biz/", label: "Colorado Secretary of State — business center" },
        record: { templateKey: "llc", fields: [] },
        check: { type: "RECORD_EXISTS", templateKey: "llc" },
      },
      {
        key: "sos-account",
        title: "Create your Secretary of State account",
        body: "Create a Secure Business Filing account on the same site so you can file the yearly periodic report without starting over. Save the login in your password manager — the logins vault (coming with VAULT-2) will hold it in the app later.",
        link: { href: "https://www.sos.state.co.us/biz/", label: "Colorado Secretary of State — business center" },
        record: { templateKey: "sos-account", fields: [] },
        check: { type: "RECORD_EXISTS", templateKey: "sos-account" },
      },
      {
        key: "registered-agent",
        title: "Name your registered agent",
        body: "Your Articles of Organization name a registered agent — the person or service that receives legal papers for the LLC. Most owners act as their own agent with their business mailing address. Record who it is so it is never a surprise.",
        record: { templateKey: "registered-agent", fields: [] },
        check: { type: "RECORD_EXISTS", templateKey: "registered-agent" },
      },
      {
        key: "operating-agreement",
        title: "Sign and store the operating agreement",
        body: "The operating agreement says who owns the LLC and how decisions get made. Even a single-member LLC should have one — banks ask for it. Sign it, scan it, and attach the file here; it is stored privately and never shared.",
        record: { templateKey: "operating-agreement", fields: ["file"] },
        check: { type: "RECORD_HAS_FILE", templateKey: "operating-agreement" },
      },
      {
        key: "trade-name",
        title: "Register the trade name, if you use one",
        body: "If customers will know you by a name that is not the LLC's legal name, file a Statement of Trade Name with the Secretary of State. If you only ever trade as Robinson Appliance Rentals LLC, mark this step done — there is nothing to file.",
        link: { href: "https://www.sos.state.co.us/biz/", label: "Colorado Secretary of State — business center" },
        record: { templateKey: "trade-name", fields: [] },
      },
    ],
  },
  {
    key: "ein",
    title: "Federal tax number (EIN)",
    why: "The EIN is the business's tax ID. The bank, Stripe, your CPA and every tax filing need it, and the app stores it encrypted — only the last 4 digits ever show.",
    unlocks: ["Business bank account", "1099 and payroll filings", "Supplier and CPA paperwork"],
    needs: ["Your LLC's legal name and forming date", "Your own Social Security number (the IRS asks the responsible party)"],
    estimatedMinutes: 15,
    steps: [
      {
        key: "apply-ein",
        title: "Apply on the IRS site (free)",
        body: "Use the IRS online application — it is free and gives the number at the end. Never pay a site that asks for a fee to get an EIN. When the confirmation screen shows the number, type it here; it is stored encrypted.",
        link: { href: "https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online", label: "IRS — apply for an EIN online" },
        record: { templateKey: "ein", fields: ["number"] },
        check: { type: "RECORD_HAS_NUMBER", templateKey: "ein" },
      },
      {
        key: "save-ein-letter",
        title: "Save the EIN letter (CP 575)",
        body: "The IRS mails a letter (CP 575) confirming the EIN a few weeks after you apply. When it arrives, scan it and attach it here — it is the proof banks and the state accept when a number is questioned.",
        record: { templateKey: "ein-letter", fields: ["file"] },
        check: { type: "RECORD_HAS_FILE", templateKey: "ein-letter" },
      },
    ],
  },
  {
    key: "bank-and-stripe",
    title: "Bank account and Stripe",
    why: "Rental money must never mix with personal money. A business bank account plus Stripe is how customers will pay you and how the books stay clean.",
    unlocks: ["Taking card and bank payments", "Clean books from day one"],
    needs: ["Your EIN letter or number", "Your Articles of Organization", "A photo ID"],
    estimatedMinutes: 45,
    steps: [
      {
        key: "open-bank-account",
        title: "Open the business bank account",
        body: "Take the EIN, the Articles of Organization and your operating agreement to the bank (or open the account online). Ask for the account and routing numbers in writing — you will give them to Stripe next, and the app keeps the account's last 4 on the record.",
        record: { templateKey: "bank-account", fields: ["number"] },
        check: { type: "RECORD_EXISTS", templateKey: "bank-account" },
      },
      {
        key: "open-stripe",
        title: "Open the Stripe account",
        body: "Create the Stripe account with the business's legal name, EIN and the new bank account. Stripe verifies the business before payouts start, so do this before you need the first payment.",
        link: { href: "https://dashboard.stripe.com/", label: "Stripe dashboard" },
        record: { templateKey: "stripe-account", fields: [] },
        check: { type: "RECORD_EXISTS", templateKey: "stripe-account" },
      },
      {
        key: "connect-stripe",
        title: "Connect Stripe to the app",
        body: "In the Stripe dashboard choose Developers → API keys, and in Vercel choose your project → Settings → Environment Variables and add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET. The app only ever checks that the keys are there — it never shows them.",
        link: { href: "https://dashboard.stripe.com/apikeys", label: "Stripe — API keys" },
        check: { type: "ENV_PRESENT", env: "STRIPE_SECRET_KEY" },
      },
    ],
  },
  {
    key: "colorado-sales-tax",
    title: "Colorado sales tax license",
    why: "Rentals are taxable in Colorado, so you need a sales tax license before the first rental, and accounts to file and pay what you collect.",
    unlocks: ["Legal renting", "Sales tax filing in the app"],
    needs: ["Your EIN", "Your LLC details and business address"],
    estimatedMinutes: 40,
    steps: [
      {
        key: "sales-tax-license",
        title: "Get the sales tax license",
        body: "Apply through Colorado Business Express or Revenue Online. The license number goes on your returns; save it here (stored encrypted, last 4 shown). Colorado licenses renew at the end of odd-numbered years — the record reminds you.",
        link: { href: "https://tax.colorado.gov/", label: "Colorado Department of Revenue — Taxation" },
        record: { templateKey: "co-sales-tax-license", fields: ["number"] },
        check: { type: "RECORD_HAS_NUMBER", templateKey: "co-sales-tax-license" },
      },
      {
        key: "revenue-online",
        title: "Create your Revenue Online login",
        body: "Revenue Online is where you file and pay state sales tax and check your account. Create the login, then record it so the filing screens can point you to the right place.",
        link: { href: "https://www.colorado.gov/revenueonline", label: "Colorado Revenue Online" },
        record: { templateKey: "revenue-online-login", fields: [] },
        check: { type: "RECORD_EXISTS", templateKey: "revenue-online-login" },
      },
      {
        key: "suts-account",
        title: "Set up SUTS for city and county taxes",
        body: "Home-rule cities like Greeley collect their own sales tax through SUTS (the Sales & Use Tax System). Create the account so the app's filing account matches how you really file.",
        link: { href: "https://tax.colorado.gov/", label: "Colorado Department of Revenue — Taxation" },
        record: { templateKey: "suts-account", fields: [] },
        check: { type: "RECORD_EXISTS", templateKey: "suts-account" },
      },
      {
        key: "filing-account",
        title: "Tell the app how you file",
        body: "In Desk → Money → Sales tax, add the filing account (license number, how often you file, your expiry). The app's returns, deadlines and reminders all read from it.",
        check: { type: "FILING_ACCOUNT_SET", kind: "SALES_RETURN" },
      },
      {
        key: "resale-certificates",
        title: "Keep resale certificates on file",
        body: "When you buy appliances you will resell or rent out, suppliers may ask for your resale certificate. Keep the form here so it is one click away when a supplier asks.",
        record: { templateKey: "resale-certificates", fields: ["file"] },
      },
    ],
  },
  {
    key: "greeley-license",
    title: "Greeley business license",
    why: "Greeley licenses businesses operating in the city. Having it before the first delivery avoids a scramble later.",
    unlocks: ["Delivering in Greeley without a licensing gap"],
    needs: ["Your Colorado sales tax license", "Your business address"],
    estimatedMinutes: 25,
    steps: [
      {
        key: "apply-greeley",
        title: "Apply with the City of Greeley",
        body: "Apply for the city's business/sales tax license through the city's site. Save the license number here — it is stored encrypted, last 4 shown.",
        link: { href: "https://greeleygov.com/", label: "City of Greeley" },
        record: { templateKey: "local-licenses", fields: ["number"] },
        check: { type: "RECORD_HAS_NUMBER", templateKey: "local-licenses" },
      },
    ],
  },
  {
    key: "weld-assessor",
    title: "Weld County assessor (business property)",
    why: "Business equipment — including the appliances you rent out — is taxable personal property in Colorado. The assessor's declaration is a yearly filing the app tracks once the account exists.",
    unlocks: ["The yearly business personal property declaration"],
    needs: ["A list of your business equipment and what it cost"],
    estimatedMinutes: 20,
    steps: [
      {
        key: "assessor-account",
        title: "Register with the assessor",
        body: "Tell the Weld County Assessor's business personal property section that the business exists, so the declaration arrives in your name each spring. Record the account here.",
        link: { href: "https://www.weldgov.com/departments/assessor", label: "Weld County Assessor" },
        record: { templateKey: "weld-assessor", fields: [] },
        check: { type: "RECORD_EXISTS", templateKey: "weld-assessor" },
      },
    ],
  },
  {
    key: "irs-accounts",
    title: "IRS online account and EFTPS",
    why: "Your IRS online account is where you see the business's tax record, and EFTPS is how federal taxes get paid. Setting both up before tax season avoids identity-verification delays.",
    unlocks: ["Paying federal taxes online", "Seeing IRS notices and balances"],
    needs: ["Your EIN letter", "A photo ID (the IRS verifies identity with ID.me)"],
    estimatedMinutes: 30,
    steps: [
      {
        key: "irs-online",
        title: "Create the IRS online account",
        body: "Create the account and finish the ID.me identity check. Once in, confirm the business shows under your profile.",
        link: { href: "https://www.irs.gov/payments/your-online-account", label: "IRS — your online account" },
        record: { templateKey: "irs-online", fields: [] },
        check: { type: "RECORD_EXISTS", templateKey: "irs-online" },
      },
      {
        key: "eftps",
        title: "Enroll in EFTPS",
        body: "EFTPS is the Treasury's payment system for federal taxes. Enroll the business; the PIN arrives by mail in about a week, so do not leave this to a deadline. IRS Direct Pay works for a one-off payment in a pinch.",
        link: { href: "https://www.eftps.gov/", label: "EFTPS — pay federal taxes" },
        record: { templateKey: "eftps", fields: [] },
        check: { type: "RECORD_EXISTS", templateKey: "eftps" },
      },
    ],
  },
  {
    key: "iris-tcc",
    title: "IRIS transmitter code (1099 e-file)",
    why: "To e-file 1099s through the IRS IRIS portal you need a Transmitter Control Code (TCC). The application can take weeks, and 1099s are due January 31 — this is the one walkthrough that cannot wait until January.",
    unlocks: ["E-filing 1099s from the app's prepared files"],
    needs: ["Your EIN", "The name and Social Security number of a responsible official"],
    estimatedMinutes: 30,
    neededBy: { monthDay: "01-31", label: "1099s are due January 31 — apply well before" },
    steps: [
      {
        key: "apply-tcc",
        title: "Apply for the IRIS TCC",
        body: "In your IRS e-Services account, apply for the Information Returns TCC for IRIS. When the code is assigned, save it here — stored encrypted, last 4 shown. The app files nothing until you approve it, TCC or not.",
        link: { href: "https://www.irs.gov/tax-professionals/e-services", label: "IRS e-Services" },
        record: { templateKey: "iris-tcc", fields: ["number"] },
        check: { type: "RECORD_HAS_NUMBER", templateKey: "iris-tcc" },
      },
    ],
  },
  {
    key: "insurance",
    title: "Insurance: three policies",
    why: "A delivery business needs liability cover, cover for the machines themselves, and vehicle cover. The app tracks each policy's renewal once the records exist.",
    unlocks: ["Renewal reminders for every policy", "Certificates when a landlord asks"],
    needs: ["Your LLC details", "A rough value of your machines and equipment"],
    estimatedMinutes: 60,
    steps: [
      {
        key: "liability",
        title: "General liability policy",
        body: "Ask an agent for general liability for an appliance rental and delivery business. When the policy issues, record it here and attach the policy or certificate file.",
        record: { templateKey: "general-liability", fields: ["file"] },
        check: { type: "RECORD_EXISTS", templateKey: "general-liability" },
      },
      {
        key: "equipment-cover",
        title: "Cover for the machines and equipment",
        body: "Equipment (or inland marine) cover pays when a machine is damaged, stolen or ruined in a customer's home. Record the policy here with its file.",
        record: { templateKey: "equipment-insurance", fields: ["file"] },
        check: { type: "RECORD_EXISTS", templateKey: "equipment-insurance" },
      },
      {
        key: "vehicle-cover",
        title: "Commercial vehicle policy",
        body: "A personal auto policy usually excludes delivery work. Get the vehicle covered for business use and record the policy here — the Vehicle walkthrough covers the registration side.",
        record: { templateKey: "vehicle-insurance", fields: ["file"] },
        check: { type: "RECORD_EXISTS", templateKey: "vehicle-insurance" },
      },
    ],
  },
  {
    key: "vehicle",
    title: "Delivery vehicle",
    why: "The truck or van needs its registration in order, its title kept safe, and a straight answer on whether federal DOT rules apply to it.",
    unlocks: ["Mileage and vehicle reminders in the app"],
    needs: ["The vehicle title or loan papers", "The current registration"],
    estimatedMinutes: 30,
    steps: [
      {
        key: "registration",
        title: "Register the vehicle",
        body: "Register (or renew) the vehicle with Weld County Motor Vehicle and keep the registration in the vehicle. Record it here so the renewal reminder runs.",
        link: { href: "https://www.weldgov.com/departments/clerk_and_recorder/motor_vehicle", label: "Weld County Motor Vehicle" },
        record: { templateKey: "vehicle-registration", fields: [] },
        check: { type: "RECORD_EXISTS", templateKey: "vehicle-registration" },
      },
      {
        key: "title",
        title: "Record the title",
        body: "Note where the title is held (you, or the lender until the loan is paid) on the title record. If you hold it, attach a scan.",
        record: { templateKey: "vehicle-title", fields: ["file"] },
        check: { type: "RECORD_EXISTS", templateKey: "vehicle-title" },
      },
      {
        key: "usdot-check",
        title: "Check whether you need a USDOT number",
        body: "A USDOT number is generally needed for vehicles over 10,000 lbs used in commerce, or crossing state lines for business. A local delivery van under that weight usually does not need one. Look up your vehicle on the federal site, and record the answer either way — a record that says 'checked, not needed' is the proof you checked.",
        link: { href: "https://safer.fmcsa.dot.gov/", label: "FMCSA — SAFER company lookup" },
        record: { templateKey: "usdot", fields: [] },
        check: { type: "RECORD_EXISTS", templateKey: "usdot" },
      },
    ],
  },
  {
    key: "email-domain",
    title: "Email domain (Google Workspace)",
    why: "Customers trust email from your own domain, and the app sends receipts and reminders from it. The domain record keeps the setup in one place.",
    unlocks: ["App email that sends from your domain"],
    needs: ["Your domain registrar login", "Your Google Workspace admin login"],
    estimatedMinutes: 35,
    steps: [
      {
        key: "workspace-domain",
        title: "Verify the domain in Workspace",
        body: "In the Google Workspace admin console (Admin → Account → Domains), verify robinsonappliancerentals.com and set up the MX records your registrar shows. Record the domain here when mail flows.",
        link: { href: "https://admin.google.com/", label: "Google Workspace admin console" },
        record: { templateKey: "workspace-domain", fields: [] },
        check: { type: "RECORD_EXISTS", templateKey: "workspace-domain" },
      },
      {
        key: "app-email-key",
        title: "Connect the app's sending key",
        body: "The app sends through Resend. In Vercel choose your project → Settings → Environment Variables and add RESEND_API_KEY. The app only checks the key is there — it never shows it.",
        check: { type: "ENV_PRESENT", env: "RESEND_API_KEY" },
      },
    ],
  },
  {
    key: "texting",
    title: "Texting (Twilio A2P)",
    why: "Customers answer texts faster than email. US carriers require businesses to register (A2P 10DLC) before texts deliver reliably. Only do this walkthrough if you chose texting — otherwise mark it Not for me.",
    unlocks: ["Delivery and reminder texts that actually arrive"],
    needs: ["Your EIN", "Your business website address"],
    estimatedMinutes: 30,
    steps: [
      {
        key: "twilio-a2p",
        title: "Register the brand and campaign",
        body: "In the Twilio console choose Messaging → Regulatory Compliance and register the brand with your EIN, then the A2P campaign for delivery and billing texts. Approval can take days. Record it here when approved.",
        link: { href: "https://console.twilio.com/", label: "Twilio console" },
        record: { templateKey: "twilio-a2p", fields: [] },
        check: { type: "RECORD_EXISTS", templateKey: "twilio-a2p" },
      },
    ],
  },
  {
    key: "encryption-keys",
    title: "Encryption keys",
    why: "Two keys protect the business's secrets: the compliance key encrypts tax numbers on records and filings, and the vault key (for the logins vault, VAULT-2) encrypts passwords. They must be different, random, and stored in Vercel — never in the app itself.",
    unlocks: ["Saving account numbers on records", "The logins vault when VAULT-2 ships"],
    needs: ["Your Vercel login", "A password manager or generator that can make a random key"],
    estimatedMinutes: 10,
    steps: [
      {
        key: "compliance-key",
        title: "Set the compliance encryption key",
        body: "Have a random 32-byte key generated (your developer or password manager can make one). In Vercel choose your project → Settings → Environment Variables and add it as COMPLIANCE_ENCRYPTION_KEY, then redeploy. Never paste the key into the app or a chat — the app only checks that it exists.",
        link: { href: "https://vercel.com/dashboard", label: "Vercel dashboard" },
        check: { type: "ENV_PRESENT", env: "COMPLIANCE_ENCRYPTION_KEY" },
      },
      {
        key: "vault-key",
        title: "Set the vault encryption key (different key)",
        body: "Generate a second, different random key and add it in Vercel as VAULT_ENCRYPTION_KEY. It encrypts the logins vault when VAULT-2 ships; using a different key means one leak never opens both.",
        link: { href: "https://vercel.com/dashboard", label: "Vercel dashboard" },
        check: { type: "ENV_PRESENT", env: "VAULT_ENCRYPTION_KEY" },
      },
    ],
  },
  {
    key: "your-cpa",
    title: "Your CPA",
    why: "A CPA who knows the business before tax season is worth far more than one hired in a panic. This walkthrough sends them what they ask for and records the engagement.",
    unlocks: ["Answers to the tax questions parked in Decisions & reviews", "A calm first tax season"],
    needs: ["Your books up to date in the app", "Any prior-year return, if you have one"],
    estimatedMinutes: 25,
    steps: [
      {
        key: "cpa-engagement",
        title: "Engage the CPA and record it",
        body: "Agree the engagement (what they file, what it costs, when) and record it here. The app's unanswered tax questions live in Decisions & reviews — send the CPA that list with the questionnaire.",
        record: { templateKey: "cpa-engagement", fields: [] },
        check: { type: "RECORD_EXISTS", templateKey: "cpa-engagement" },
      },
      {
        key: "send-books",
        title: "Send the books export",
        body: "In Desk → Books, export the year-to-date packet and send it to the CPA. Seeing real numbers early is how they catch a wrong setting while it is still cheap to fix.",
      },
    ],
  },
  {
    key: "backups",
    title: "Backups and private storage",
    why: "Record files, signed agreements and photos live in private storage, and the nightly backup copies them. This walkthrough confirms the storage is really connected — the app cannot back up to storage that was never set up.",
    unlocks: ["Nightly backups that include your files", "The export pack from Business records"],
    needs: ["Your Vercel login"],
    estimatedMinutes: 10,
    steps: [
      {
        key: "private-storage",
        title: "Confirm private storage is connected",
        body: "In Vercel choose your project → Storage and confirm the private blob store exists and its token (BLOB_READ_WRITE_TOKEN) is set for the project. The app only checks the token is there — it never shows it.",
        link: { href: "https://vercel.com/dashboard", label: "Vercel dashboard" },
        check: { type: "ENV_PRESENT", env: "BLOB_READ_WRITE_TOKEN" },
      },
    ],
  },
];

/** Plain-words line for what a check verifies — shown next to "Checked". */
export function describeCheck(check: SetupCheck): string {
  switch (check.type) {
    case "ENV_PRESENT":
      return `the app can see the ${check.env} key is set (the key itself is never shown)`;
    case "RECORD_EXISTS":
      return "the business record exists";
    case "RECORD_HAS_NUMBER":
      return "a number is saved on the business record";
    case "RECORD_HAS_FILE":
      return "a file is attached to the business record";
    case "FILING_ACCOUNT_SET":
      return "a filing account is set up in Sales tax";
  }
}

export function getWalkthrough(key: string): Walkthrough | null {
  return WALKTHROUGHS.find((w) => w.key === key) ?? null;
}

export function getStep(walkthroughKey: string, stepKey: string): { walkthrough: Walkthrough; step: SetupStep } | null {
  const walkthrough = getWalkthrough(walkthroughKey);
  if (!walkthrough) return null;
  const step = walkthrough.steps.find((s) => s.key === stepKey);
  return step ? { walkthrough, step } : null;
}

/** Days from `todayKey` (Denver YYYY-MM-DD) until the next monthDay (MM-DD), 0 when today. */
export function daysUntilMonthDay(todayKey: string, monthDay: string): number {
  const [y, m, d] = todayKey.split("-").map(Number);
  const [tm, td] = monthDay.split("-").map(Number);
  const today = Date.UTC(y, m - 1, d);
  let target = Date.UTC(y, tm - 1, td);
  if (target < today) target = Date.UTC(y + 1, tm - 1, td);
  return Math.round((target - today) / 86_400_000);
}

export type WalkthroughStanding = { key: string; complete: boolean; dismissed: boolean };

/**
 * The suggested next walkthrough (spec §9): what it unlocks soonest first —
 * an incomplete, not-dismissed walkthrough whose needed-by date falls within
 * the next 120 days, soonest first — then plain data order. Null when every
 * walkthrough is complete or dismissed.
 */
export function suggestNextWalkthrough(
  standings: readonly WalkthroughStanding[],
  now: Date,
): Walkthrough | null {
  const open = WALKTHROUGHS.filter((w) => {
    const s = standings.find((x) => x.key === w.key);
    return s && !s.complete && !s.dismissed;
  });
  if (open.length === 0) return null;
  const todayKey = businessDateKey(now);
  const seasonal = open
    .filter((w) => w.neededBy)
    .map((w) => ({ w, days: daysUntilMonthDay(todayKey, w.neededBy!.monthDay) }))
    .filter((x) => x.days <= 120)
    .sort((a, b) => a.days - b.days);
  if (seasonal.length > 0) return seasonal[0].w;
  return open[0];
}
