import type { PAPERWORK_GROUPS, RecordKind } from "./rules";

export type PaperworkTemplate = {
  key: string;
  title: string;
  group: (typeof PAPERWORK_GROUPS)[number];
  whatItIs: string;
  agency?: string;
  officialUrl?: string;
  repeatEveryMonths?: number;
  remindDaysBefore?: number;
  /** VAULT-1: what sort of business record this starter becomes. */
  kind?: RecordKind;
  /** VAULT-1: what the record's stored number is called ("EIN", "Policy number"). */
  numberLabel?: string;
  /** VAULT-1: compliance registry keys this record unlocks or feeds. */
  linkedObligationKeys?: string[];
};

/**
 * A plain starting checklist for a new Colorado rental business. It deliberately states no fees, deadlines or
 * legal conclusions: the dates come from your own documents and the agency's website (enter them on the item), and
 * every item can be edited, marked "not needed", or removed from your reminders. Ask your accountant or attorney
 * if you are unsure whether something applies to you.
 */
export const PAPERWORK_TEMPLATES: PaperworkTemplate[] = [
  {
    key: "llc",
    title: "Register your LLC",
    kind: "DOCUMENT",
    group: "Start the business",
    whatItIs:
      "Filing with the state that creates your company. Do this first, because the bank, the IRS and the tax office all ask for your company name. Save the date it became official and keep the paperwork you receive.",
    agency: "Colorado Secretary of State",
    officialUrl: "https://www.sos.state.co.us/",
  },
  {
    key: "registered-agent",
    title: "Choose your registered agent",
    kind: "CONTRACT",
    group: "Start the business",
    whatItIs:
      "The person or service the state can send legal notices to. It can be you if you have a street address in Colorado that is open during business hours. Write down who it is and any renewal date if you pay a service.",
    agency: "Colorado Secretary of State",
    officialUrl: "https://www.sos.state.co.us/",
  },
  {
    key: "ein",
    title: "Get your federal EIN",
    kind: "TAX_ACCOUNT",
    numberLabel: "EIN",
    group: "Start the business",
    whatItIs:
      "Your company's federal tax number (like a Social Security number for the business). It is free from the IRS. You need it for the bank account, taxes and the sales-tax license. Put the number in the box on this item; only the owner can see it.",
    agency: "IRS",
    officialUrl: "https://www.irs.gov/businesses/small-businesses-self-employed/employer-id-numbers",
  },
  {
    key: "operating-agreement",
    title: "Write your operating agreement",
    kind: "DOCUMENT",
    group: "Start the business",
    whatItIs:
      "Your own written rules for how the company is run and who owns it. It usually isn't filed with anyone, but banks and insurers often ask to see it. An attorney can help if you are unsure.",
  },
  {
    key: "bank-account",
    title: "Open a business bank account",
    kind: "BANK",
    numberLabel: "Account number",
    group: "Start the business",
    whatItIs:
      "A bank account in the company's name, kept separate from your personal money. Usually needs your LLC papers and EIN.",
  },
  {
    key: "co-sales-tax-license",
    title: "Colorado sales tax license",
    kind: "LICENSE",
    repeatEveryMonths: 24,
    group: "Taxes",
    whatItIs:
      "Permission from the Colorado Department of Revenue to collect sales tax. Needs your LLC and EIN. When you get it, enter the date it expires and how often it renews (shown on the license). This app then reminds you before it runs out.",
    agency: "Colorado Department of Revenue",
    officialUrl: "https://tax.colorado.gov/how-to-apply-for-a-colorado-sales-tax-license",
    remindDaysBefore: 60,
  },
  {
    key: "suts-account",
    title: "Set up your Colorado tax website account (SUTS)",
    kind: "ACCOUNT",
    group: "Taxes",
    whatItIs:
      "The state's website where sales-tax returns are filed. After your license is issued, sign in, then enter your details in this app under Taxes → Filing accounts so the return packet matches.",
    agency: "Colorado Department of Revenue",
    officialUrl: "https://tax.colorado.gov/",
  },
  {
    key: "tax-rate-key",
    title: "Get Colorado's tax-rate lookup key",
    kind: "ACCOUNT",
    group: "Taxes",
    whatItIs:
      "Once you can sign in to the state tax website, it offers a key that lets this app look up the right tax rate for each address automatically. Until you have it, the app asks you to review each new address, which is safe. The key goes only into the hosting settings, never into email or chat. Your checklist has the exact steps.",
    agency: "Colorado Department of Revenue",
  },
  {
    key: "local-licenses",
    title: "City and county business or tax licenses",
    kind: "LICENSE",
    linkedObligationKeys: ["greeley.business_license"],
    group: "Licenses and permits",
    whatItIs:
      "Some cities and counties want their own business license, or collect their own sales tax. Call or check the websites of the city and county where you operate and where you deliver, and write down what they tell you. Mark this 'Not needed' if they say you don't need anything.",
  },
  {
    key: "general-liability",
    title: "Business liability insurance",
    kind: "INSURANCE",
    numberLabel: "Policy number",
    group: "Insurance",
    whatItIs:
      "Insurance that covers damage or injuries connected to your business, such as an appliance causing a flood. Enter the policy number and the date it renews.",
    remindDaysBefore: 45,
    repeatEveryMonths: 12,
  },
  {
    key: "vehicle-insurance",
    title: "Insurance for the delivery vehicle",
    kind: "INSURANCE",
    numberLabel: "Policy number",
    group: "Insurance",
    whatItIs:
      "Make sure the vehicle you use to deliver is insured for business use. Ask your insurance agent. Enter the renewal date once you have it.",
    remindDaysBefore: 45,
    repeatEveryMonths: 12,
  },
  {
    key: "periodic-report",
    title: "Colorado yearly report (periodic report)",
    kind: "REGISTRATION",
    linkedObligationKeys: ["co.sos.periodic_report"],
    group: "Every year",
    whatItIs:
      "Colorado asks every LLC to file a short report each year to stay in good standing. The state's website shows the date window for your company. Enter that date here, and this app reminds you before it. When you file it, press 'Mark done and schedule next year'.",
    agency: "Colorado Secretary of State",
    officialUrl: "https://www.sos.state.co.us/pubs/business/FAQs/reports.html",
    repeatEveryMonths: 12,
    remindDaysBefore: 45,
  },
  {
    key: "yearly-review",
    title: "Yearly paperwork check-up",
    kind: "TASK",
    group: "Every year",
    whatItIs:
      "Once a year, look over this page: insurance, licenses, who your registered agent is, and your bank and accountant details. Set the date and this app will remind you.",
    repeatEveryMonths: 12,
    remindDaysBefore: 14,
  },
  {
    key: "ein-letter",
    title: "EIN confirmation letter (CP 575 or 147C)",
    group: "Start the business",
    whatItIs:
      "The letter the IRS sent when your EIN was issued (or the 147C replacement you can request). Save a copy of the letter as a file on this record — banks and the state ask for it.",
    agency: "IRS",
    kind: "DOCUMENT",
  },
  {
    key: "co-account-number",
    title: "Colorado sales tax account number",
    group: "Taxes",
    whatItIs:
      "The account number the state gave your business for sales tax (shown in Revenue Online and on your license). Enter it as this record's number; only the owner can see it.",
    agency: "Colorado Department of Revenue",
    kind: "TAX_ACCOUNT",
    numberLabel: "Colorado account number",
  },
  {
    key: "revenue-online-login",
    title: "Colorado Revenue Online login",
    group: "Taxes",
    whatItIs:
      "Your sign-in for the state's tax website, where sales tax and employer accounts live. The login itself belongs in the vault (a later step); this record tracks that it exists and when it was set up.",
    agency: "Colorado Department of Revenue",
    officialUrl: "https://www.colorado.gov/revenueonline",
    kind: "ACCOUNT",
  },
  {
    key: "weld-assessor",
    title: "Weld County assessor — business personal property",
    group: "Taxes",
    whatItIs:
      "Businesses declare their equipment (appliances you own for renting count) to the county assessor each year. This record tracks your assessor account; the yearly declaration itself is on your compliance list.",
    agency: "Weld County Assessor",
    officialUrl: "https://www.weldgov.com",
    kind: "TAX_ACCOUNT",
    linkedObligationKeys: ["co.bpp.weld_declaration"],
  },
  {
    key: "iris-tcc",
    title: "IRS IRIS transmitter control code (TCC)",
    group: "Taxes",
    whatItIs:
      "The code that lets the business send 1099 forms to the IRS electronically through IRIS. Apply inside IRIS; when it is issued, enter the code as this record's number.",
    agency: "IRS",
    officialUrl: "https://www.irs.gov/e-file-providers",
    kind: "TAX_ACCOUNT",
    numberLabel: "TCC",
    linkedObligationKeys: ["fed.1099_nec", "fed.1099_misc"],
  },
  {
    key: "irs-online",
    title: "IRS business online account",
    group: "Taxes",
    whatItIs:
      "Your sign-in on IRS.gov for the business tax account (balances, notices, payment history). The login itself belongs in the vault (a later step).",
    agency: "IRS",
    officialUrl: "https://www.irs.gov/businesses",
    kind: "ACCOUNT",
  },
  {
    key: "eftps",
    title: "EFTPS enrollment (federal tax payments)",
    group: "Taxes",
    whatItIs:
      "The federal payment system for business taxes. Enrollment takes about a week because a PIN comes by mail. The login itself belongs in the vault (a later step).",
    agency: "IRS / EFTPS",
    officialUrl: "https://www.eftps.gov",
    kind: "ACCOUNT",
  },
  {
    key: "sos-account",
    title: "Colorado Secretary of State business account",
    group: "Start the business",
    whatItIs:
      "Your sign-in on the Secretary of State website, used for the yearly periodic report and any filings. The login itself belongs in the vault (a later step).",
    agency: "Colorado Secretary of State",
    officialUrl: "https://www.sos.state.co.us",
    kind: "ACCOUNT",
    linkedObligationKeys: ["co.sos.periodic_report"],
  },
  {
    key: "trade-name",
    title: "Trade name filing (DBA)",
    group: "Start the business",
    whatItIs:
      "If the business operates under a name different from the LLC's legal name, that trade name is filed with the Secretary of State. Mark 'Not needed' if you only use the LLC name.",
    agency: "Colorado Secretary of State",
    officialUrl: "https://www.sos.state.co.us",
    kind: "REGISTRATION",
    linkedObligationKeys: ["co.sos.trade_name"],
  },
  {
    key: "stripe-account",
    title: "Stripe account",
    group: "Start the business",
    whatItIs:
      "The card-payment account. The login itself belongs in the vault (a later step); this record tracks that it exists and who the account contact is.",
    kind: "ACCOUNT",
  },
  {
    key: "workspace-domain",
    title: "Google Workspace and domain name",
    group: "Other",
    whatItIs:
      "The business email accounts and the website domain. Enter the renewal date and the yearly cost so the renewal shows up on your To do list before anything lapses.",
    kind: "CONTRACT",
    repeatEveryMonths: 12,
    remindDaysBefore: 45,
  },
  {
    key: "vercel-neon",
    title: "Vercel and Neon plans (app hosting and database)",
    group: "Other",
    whatItIs:
      "The services this app runs on. Enter the renewal dates and costs if you are on paid plans; mark 'Not needed' while you are on free plans.",
    kind: "CONTRACT",
  },
  {
    key: "equipment-insurance",
    title: "Equipment / inland marine insurance",
    group: "Insurance",
    whatItIs:
      "Insurance that covers the appliances themselves while they are stored, moved and installed in customers' homes. Enter the policy number and the renewal date.",
    remindDaysBefore: 45,
    repeatEveryMonths: 12,
    kind: "INSURANCE",
    numberLabel: "Policy number",
  },
  {
    key: "vehicle-title",
    title: "Vehicle titles",
    group: "Other",
    whatItIs:
      "The title for each business vehicle. Save a photo or scan of each title as a file on this record.",
    kind: "DOCUMENT",
  },
  {
    key: "vehicle-registration",
    title: "Vehicle registrations",
    group: "Every year",
    whatItIs:
      "Each business vehicle's registration renews in its own month. Enter the next renewal month as the date; when you renew, press 'Renewed' and this app schedules the next year.",
    agency: "Colorado Division of Motor Vehicles",
    repeatEveryMonths: 12,
    remindDaysBefore: 30,
    kind: "REGISTRATION",
    linkedObligationKeys: ["co.vehicle_registration"],
  },
  {
    key: "usdot",
    title: "USDOT number",
    group: "Licenses and permits",
    whatItIs:
      "Only needed if a vehicle is rated 16,001 lbs or more loaded (GVWR). Most small delivery trucks are under that — if yours is, mark this 'Not needed'.",
    agency: "FMCSA",
    officialUrl: "https://www.fmcsa.dot.gov/registration",
    kind: "REGISTRATION",
    numberLabel: "USDOT number",
    linkedObligationKeys: ["fed.usdot"],
  },
  {
    key: "resale-certificates",
    title: "Resale / exemption certificates you give suppliers",
    group: "Taxes",
    whatItIs:
      "The certificates that let you buy appliances for renting without paying sales tax at the store. Save a copy of each certificate as a file on this record so staff can show it at purchase time.",
    kind: "DOCUMENT",
  },
  {
    key: "twilio-a2p",
    title: "Texting registration (A2P)",
    group: "Other",
    whatItIs:
      "Business texting needs a one-time registration of the business and its phone number with the carriers. Only needed when texting is turned on; otherwise mark 'Not needed'.",
    kind: "REGISTRATION",
  },
  {
    key: "cpa-engagement",
    title: "CPA engagement letter",
    group: "Other",
    whatItIs:
      "The signed agreement with your accountant: what they prepare, what it costs and when. Save the signed letter as a file on this record.",
    kind: "CONTRACT",
  },
];
