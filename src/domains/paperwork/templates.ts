import type { PAPERWORK_GROUPS } from "./rules";

export type PaperworkTemplate = {
  key: string;
  title: string;
  group: (typeof PAPERWORK_GROUPS)[number];
  whatItIs: string;
  agency?: string;
  officialUrl?: string;
  repeatEveryMonths?: number;
  remindDaysBefore?: number;
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
    group: "Start the business",
    whatItIs:
      "Filing with the state that creates your company. Do this first, because the bank, the IRS and the tax office all ask for your company name. Save the date it became official and keep the paperwork you receive.",
    agency: "Colorado Secretary of State",
    officialUrl: "https://www.sos.state.co.us/",
  },
  {
    key: "registered-agent",
    title: "Choose your registered agent",
    group: "Start the business",
    whatItIs:
      "The person or service the state can send legal notices to. It can be you if you have a street address in Colorado that is open during business hours. Write down who it is and any renewal date if you pay a service.",
    agency: "Colorado Secretary of State",
    officialUrl: "https://www.sos.state.co.us/",
  },
  {
    key: "ein",
    title: "Get your federal EIN",
    group: "Start the business",
    whatItIs:
      "Your company's federal tax number (like a Social Security number for the business). It is free from the IRS. You need it for the bank account, taxes and the sales-tax license. Put the number in the box on this item; only the owner can see it.",
    agency: "IRS",
    officialUrl: "https://www.irs.gov/businesses/small-businesses-self-employed/employer-id-numbers",
  },
  {
    key: "operating-agreement",
    title: "Write your operating agreement",
    group: "Start the business",
    whatItIs:
      "Your own written rules for how the company is run and who owns it. It usually isn't filed with anyone, but banks and insurers often ask to see it. An attorney can help if you are unsure.",
  },
  {
    key: "bank-account",
    title: "Open a business bank account",
    group: "Start the business",
    whatItIs:
      "A bank account in the company's name, kept separate from your personal money. Usually needs your LLC papers and EIN.",
  },
  {
    key: "co-sales-tax-license",
    title: "Colorado sales tax license",
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
    group: "Taxes",
    whatItIs:
      "The state's website where sales-tax returns are filed. After your license is issued, sign in, then enter your details in this app under Taxes → Filing accounts so the return packet matches.",
    agency: "Colorado Department of Revenue",
    officialUrl: "https://tax.colorado.gov/",
  },
  {
    key: "tax-rate-key",
    title: "Get Colorado's tax-rate lookup key",
    group: "Taxes",
    whatItIs:
      "Once you can sign in to the state tax website, it offers a key that lets this app look up the right tax rate for each address automatically. Until you have it, the app asks you to review each new address, which is safe. The key goes only into the hosting settings, never into email or chat. Your checklist has the exact steps.",
    agency: "Colorado Department of Revenue",
  },
  {
    key: "local-licenses",
    title: "City and county business or tax licenses",
    group: "Licenses and permits",
    whatItIs:
      "Some cities and counties want their own business license, or collect their own sales tax. Call or check the websites of the city and county where you operate and where you deliver, and write down what they tell you. Mark this 'Not needed' if they say you don't need anything.",
  },
  {
    key: "general-liability",
    title: "Business liability insurance",
    group: "Insurance",
    whatItIs:
      "Insurance that covers damage or injuries connected to your business, such as an appliance causing a flood. Enter the policy number and the date it renews.",
    remindDaysBefore: 45,
    repeatEveryMonths: 12,
  },
  {
    key: "vehicle-insurance",
    title: "Insurance for the delivery vehicle",
    group: "Insurance",
    whatItIs:
      "Make sure the vehicle you use to deliver is insured for business use. Ask your insurance agent. Enter the renewal date once you have it.",
    remindDaysBefore: 45,
    repeatEveryMonths: 12,
  },
  {
    key: "periodic-report",
    title: "Colorado yearly report (periodic report)",
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
    group: "Every year",
    whatItIs:
      "Once a year, look over this page: insurance, licenses, who your registered agent is, and your bank and accountant details. Set the date and this app will remind you.",
    repeatEveryMonths: 12,
    remindDaysBefore: 14,
  },
];
