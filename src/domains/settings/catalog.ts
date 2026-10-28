// AR-8 (SETTINGS spec section 4): the settings catalog — pure data, no database.
//
// Every BusinessSettings field is accounted for here exactly once: as an
// editable row in SETTING_ROWS, as a field covered by a panel/link row's
// `covers` list (its existing editor owns it), or in NOT_A_SETTING with the
// reason it is not an owner setting. tests/settings-catalog.test.ts reads
// the Prisma model and fails when a field is in none of those places, so a
// later card that adds a setting must add its catalog entry in the same PR.
//
// `recommended` is the schema default for the field, except where a dated
// owner answer or DEC-2 research gives another value — then `decisionId`
// names the DEC-1 subject and the recommended value is read from the
// registry at render time (one source).

import type { FeatureKey } from "@/domains/features/registry";

export type SettingsSectionId =
  | "decisions" | "business" | "prices" | "rentals" | "team"
  | "messages" | "money" | "website" | "advanced";

export type SettingKind =
  | "money" | "days" | "hours" | "minutes" | "number" | "percent"
  | "yesno" | "text" | "list" | "choice" | "panel" | "link";

export type SettingRowDef = {
  key: string;
  section: SettingsSectionId;
  group?: string;
  label: string;
  keywords: string[];
  kind: SettingKind;
  choices?: { value: string; label: string }[];
  min?: number;
  max?: number;
  what: string;
  recommended?: unknown;
  why?: string;
  who: "owner" | "finance";
  appliesTo?: string;
  editor: "row" | { domainWriter: string } | { panelHref: string } | { panelComponent: string };
  covers?: string[];
  auditActions?: string[];
  feature?: FeatureKey;
  decisionId?: string;
};

export const SETTINGS_SECTIONS_V2: { id: SettingsSectionId; label: string; icon: string }[] = [
  { id: "decisions", label: "Decisions & reviews", icon: "help" },
  { id: "business", label: "Business", icon: "home" },
  { id: "prices", label: "Prices & packages", icon: "money" },
  { id: "rentals", label: "Rentals & policies", icon: "equipment" },
  { id: "team", label: "Team & access", icon: "customers" },
  { id: "messages", label: "Messages & phone", icon: "email" },
  { id: "money", label: "Money & taxes", icon: "bill" },
  { id: "website", label: "Website", icon: "map" },
  { id: "advanced", label: "Advanced", icon: "gear" },
];

/** SETTINGS spec section 2: old `?section=` ids land on the new sections. */
export const OLD_SECTION_REDIRECTS: Record<string, SettingsSectionId> = {
  profile: "business",
  "service-area": "business",
  products: "prices",
  policies: "rentals",
  terms: "rentals",
  pickups: "rentals",
  jobs: "rentals",
  notifications: "messages",
  security: "team",
  staff: "team",
  integrations: "advanced",
};

const row = (def: SettingRowDef): SettingRowDef => def;

export const SETTING_ROWS: SettingRowDef[] = [
  // ---- 4.1 decisions ----
  row({
    key: "decisionsQuestions", section: "decisions", label: "Questions waiting",
    keywords: ["decisions", "questions", "cpa", "attorney", "starting values"],
    kind: "panel", what: "The open questions for you and your professionals, with the starting values the app is using meanwhile.",
    who: "owner", editor: { panelHref: "/desk/settings/decisions" },
  }),

  // ---- 4.2 business · Public details ----
  row({ key: "publicBusinessName", section: "business", group: "Public details", label: "Business name", keywords: ["name", "public"], kind: "text", what: "The name customers see on the website, quotes and bills.", who: "finance", editor: "row" }),
  row({ key: "publicPhone", section: "business", group: "Public details", label: "Public phone", keywords: ["phone", "call"], kind: "text", what: "The phone number customers see and call.", who: "finance", editor: "row" }),
  row({ key: "publicEmail", section: "business", group: "Public details", label: "Public email", keywords: ["email", "contact"], kind: "text", what: "The email address customers see and write to.", who: "finance", editor: "row" }),
  row({ key: "publicAddress", section: "business", group: "Public details", label: "Public address", keywords: ["address", "location"], kind: "text", what: "The address shown to customers.", who: "finance", editor: "row" }),
  row({ key: "hoursPanel", section: "business", group: "Public details", label: "Opening hours", keywords: ["hours", "open", "closed", "holidays"], kind: "panel", what: "When the business is open, and the holiday closures.", who: "finance", editor: { panelComponent: "HoursPanel" }, covers: ["hours", "holidayClosures"] }),
  row({ key: "socialLinksPanel", section: "business", group: "Public details", label: "Social links", keywords: ["facebook", "instagram", "social"], kind: "panel", what: "Links to your social pages, shown on the website.", who: "finance", editor: { panelComponent: "SocialLinksPanel" }, covers: ["socialLinks"] }),
  row({ key: "logoPanel", section: "business", group: "Public details", label: "Logo", keywords: ["logo", "brand", "picture"], kind: "panel", what: "The logo shown on the website and documents.", who: "finance", editor: { panelComponent: "LogoPanel" }, covers: ["logoUrl"] }),

  // ---- 4.2 business · Where you work ----
  row({ key: "serviceAreaPanel", section: "business", group: "Where you work", label: "Service area", keywords: ["service area", "cities", "zip", "towns"], kind: "panel", what: "The cities and ZIP codes you take rentals in.", who: "finance", editor: { panelComponent: "ServiceAreaPanel" }, covers: ["serviceAreaCities", "serviceAreaZips"] }),
  row({ key: "drivingOriginPanel", section: "business", group: "Where you work", label: "Where deliveries are measured from", keywords: ["origin", "miles", "distance", "address"], kind: "panel", what: "The address delivery distances and zones are measured from.", who: "owner", editor: { panelComponent: "DrivingOriginPanel" }, covers: ["drivingOriginAddress"] }),
  row({ key: "deliveryZonesPanel", section: "business", group: "Where you work", label: "Delivery zones", keywords: ["zones", "miles", "delivery area", "map"], kind: "panel", what: "The delivery zones around you, their prices, and how far you deliver.", who: "finance", editor: { panelComponent: "DeliveryZonesForm" }, covers: ["deliveryZones", "deliveryMaxMiles", "zoneCenter", "zoneDistanceMethod", "showDeliveryPricesOnWebsite"] }),
  row({ key: "goalsPanel", section: "business", group: "Goals", label: "Goals and alerts", keywords: ["goals", "alerts", "idle", "fleet"], kind: "panel", what: "Your goals, and when to flag appliances that sit idle or a fleet that is nearly full.", who: "finance", editor: { panelHref: "/desk/settings/goals" }, covers: ["idleApplianceAlertDays", "utilizationAlertPercent"] }),
  row({ key: "paperworkLink", section: "business", group: "Business records", label: "Business paperwork", keywords: ["paperwork", "records", "documents", "licenses"], kind: "link", what: "Your business records: licenses, permits, insurance and contracts.", who: "owner", editor: { panelHref: "/desk/paperwork" }, covers: ["paperworkAdminKinds"] }),
  row({ key: "complianceProfileLink", section: "business", group: "Business records", label: "Compliance profile", keywords: ["compliance", "mileage", "insurance", "workers comp", "vendors"], kind: "link", what: "The facts your compliance dates are worked out from: mileage, insurance, workers comp and vendor reviews.", who: "finance", editor: { panelHref: "/desk/compliance" }, covers: ["mileageMethod", "vehicleMedicalCardRequired", "insuranceRemindFirstDays", "insuranceRemindSecondDays", "workersCompStatus", "workersCompEmployees", "workersCompNote", "workersCompFormSentOn", "workersCompMailNumber", "vendorReviewMonths", "vendor1099ThresholdCents"] }),

  // ---- 4.3 prices ----
  row({ key: "appliancePricesPanel", section: "prices", label: "Appliance prices", keywords: ["prices", "rent", "monthly"], kind: "panel", what: "What each kind of appliance rents for each month.", who: "finance", editor: { panelComponent: "AppliancePricingTable" } }),
  row({ key: "packagesPanel", section: "prices", label: "Sets and packages", keywords: ["sets", "packages", "bundle", "washer dryer set"], kind: "panel", what: "The sets you rent together, and what each set costs.", who: "finance", editor: { panelComponent: "PackageTable" } }),
  row({ key: "priceChangesPanel", section: "prices", label: "Price changes with a start date", keywords: ["price changes", "future", "start date"], kind: "panel", what: "Price changes you have set to begin on a future date.", who: "finance", editor: { panelHref: "/desk/settings/price-changes" } }),
  row({ key: "signingChargesPanel", section: "prices", label: "New-order setup fee and down payment", keywords: ["setup fee", "down payment", "signing", "new order"], kind: "panel", what: "The one-time setup fee on a new order, and the down payment rules for large orders.", who: "owner", editor: { panelComponent: "SigningChargeForm" }, covers: ["administrativeSetupFeeCents", "largeOrderMachineThreshold", "largeOrderCancellationFullRefundHours", "businessRequiresDownPayment", "setupFeeTaxTreatment", "setupFeeTaxPlanningTreatment"] }),
  row({ key: "mandatoryFeesPanel", section: "prices", label: "Required fees on complete quotes", keywords: ["required fees", "quotes", "policy"], kind: "panel", what: "Which fees a complete quote must always include.", who: "owner", editor: { panelComponent: "MandatorySigningPolicyForm" }, covers: ["signingMandatoryPolicyVersions"] }),

  // ---- 4.4 rentals · Fees ----
  row({ key: "oneTimeDeliveryFeeCents", section: "rentals", group: "Fees", label: "Delivery fee", keywords: ["delivery", "fee", "one-time"], kind: "money", what: "The one-time fee for delivering an appliance when no zone price applies.", recommended: 0, why: "Zone prices cover most deliveries; this is the fallback.", who: "finance", editor: "row" }),
  row({ key: "oneTimeInstallationFeeCents", section: "rentals", group: "Fees", label: "Installation fee", keywords: ["install", "installation", "fee"], kind: "money", what: "The one-time fee for installing an appliance.", recommended: 0, why: "Starts at $0 until you decide to charge for installs.", who: "finance", editor: "row" }),
  row({ key: "oneTimeRemovalFeeCents", section: "rentals", group: "Fees", label: "Removal fee", keywords: ["removal", "pickup", "fee"], kind: "money", what: "The one-time fee for picking up an appliance at the end.", recommended: 0, why: "Starts at $0 until you decide to charge for pickups.", who: "finance", editor: "row" }),
  row({ key: "oneTimeHaulAwayFeeCents", section: "rentals", group: "Fees", label: "Haul-away fee", keywords: ["haul away", "old appliance", "fee"], kind: "money", what: "The one-time fee for hauling away the customer's old appliance; the service is only offered once this has a price.", recommended: 0, why: "$0 means not priced yet, so haul-away is not offered.", who: "finance", editor: "row" }),
  row({ key: "relocationFeeCents", section: "rentals", group: "Fees", label: "Moving an appliance to a new address", keywords: ["moving", "relocation", "new address"], kind: "money", what: "The fee when a customer moves and their appliance goes with them.", recommended: 7500, why: "About the cost of one extra trip.", who: "finance", editor: "row" }),
  row({ key: "missedTripFeeCents", section: "rentals", group: "Fees", label: "Trip fee when nobody is home", keywords: ["missed", "nobody home", "trip fee"], kind: "money", what: "The fee when a crew arrives and nobody is home.", recommended: 0, why: "Off until you decide to charge one.", who: "finance", editor: "row" }),
  row({ key: "damageWaiverEnabled", section: "rentals", group: "Fees", label: "Damage waiver", keywords: ["damage", "waiver", "protection"], kind: "yesno", what: "Whether customers can add the damage waiver to a rental.", recommended: false, why: "Off until the waiver terms are ready.", who: "finance", editor: "row" }),
  row({ key: "depositEnabled", section: "rentals", group: "Fees", label: "Deposits", keywords: ["deposit", "security"], kind: "yesno", what: "Whether new rentals ask for a deposit.", recommended: false, why: "Off until you decide to take deposits.", who: "finance", editor: "row" }),

  // ---- 4.4 rentals · Late payments ----
  row({ key: "lateFeeGraceDays", section: "rentals", group: "Late payments", label: "Late fee grace days", keywords: ["late", "grace", "days"], kind: "days", min: 10, max: 60, what: "How many days a bill can be late before a late fee is added.", recommended: 10, why: "Ten days is fair warning without letting bills drift.", who: "finance", editor: "row", decisionId: "IN-84" }),
  row({ key: "lateFeeFlatCents", section: "rentals", group: "Late payments", label: "Flat late fee", keywords: ["late", "fee", "flat"], kind: "money", max: 15, what: "A flat late fee added once a bill passes the grace days.", recommended: 0, why: "Starts at $0 until you set the late fee you want.", who: "finance", editor: "row", decisionId: "IN-84" }),
  row({ key: "lateFeePercent", section: "rentals", group: "Late payments", label: "Late fee percent", keywords: ["late", "percent", "%"], kind: "percent", min: 0, max: 100, what: "A late fee worked out as a share of the late bill, if you use one.", recommended: 0, why: "Starts at 0% until you set the late fee you want.", who: "finance", editor: "row", decisionId: "IN-84" }),
  row({ key: "bankPaymentSlowBusinessDays", section: "rentals", group: "Late payments", label: "Days a bank payment may take", keywords: ["bank", "ach", "payment in progress"], kind: "panel", what: "While a bank payment is being confirmed, late fees pause for this many business days.", who: "owner", editor: { panelComponent: "BankPaymentForm" }, covers: ["bankPaymentSlowBusinessDays"], auditActions: ["settings.bank_payment_slow_days.update"] }),
  row({ key: "lateFeeNoticeDaysBefore", section: "rentals", group: "Late payments", label: "Late fee warning days", keywords: ["late", "warning", "notice"], kind: "panel", what: "How many days before a late fee lands the customer is warned.", who: "owner", editor: { panelComponent: "LateFeeNoticeForm" }, covers: ["lateFeeNoticeDaysBefore"] }),

  // ---- 4.4 rentals · Prepay discounts ----
  row({ key: "sixMonthPrepayDiscountSetCents", section: "rentals", group: "Prepay discounts", label: "6-month prepay discount (set)", keywords: ["prepay", "discount", "6 month", "set"], kind: "money", what: "Money off when a customer pays 6 months ahead for a washer and dryer set.", recommended: 500, why: "A small thank-you that still covers your costs.", who: "finance", editor: "row" }),
  row({ key: "sixMonthPrepayDiscountSingleCents", section: "rentals", group: "Prepay discounts", label: "6-month prepay discount (single)", keywords: ["prepay", "discount", "6 month", "single"], kind: "money", what: "Money off when a customer pays 6 months ahead for one appliance.", recommended: 250, why: "Half the set discount, for one machine.", who: "finance", editor: "row" }),
  row({ key: "twelveMonthPrepayDiscountSetCents", section: "rentals", group: "Prepay discounts", label: "12-month prepay discount (set)", keywords: ["prepay", "discount", "12 month", "set"], kind: "money", what: "Money off when a customer pays 12 months ahead for a washer and dryer set.", recommended: 1000, why: "A bigger thank-you for a full year paid ahead.", who: "finance", editor: "row" }),
  row({ key: "twelveMonthPrepayDiscountSingleCents", section: "rentals", group: "Prepay discounts", label: "12-month prepay discount (single)", keywords: ["prepay", "discount", "12 month", "single"], kind: "money", what: "Money off when a customer pays 12 months ahead for one appliance.", recommended: 500, why: "Half the set discount, for one machine.", who: "finance", editor: "row" }),
  row({ key: "twelveMonthPrepayFreeMonthEnabled", section: "rentals", group: "Prepay discounts", label: "Free month with 12-month prepay", keywords: ["prepay", "free month", "12 month"], kind: "yesno", what: "Whether paying 12 months ahead also earns a free month.", recommended: true, why: "The free month is the main reason to pay a year ahead.", who: "finance", editor: "row" }),
  row({ key: "referralRewardCents", section: "rentals", group: "Prepay discounts", label: "Referral reward", keywords: ["referral", "reward", "recommend"], kind: "money", what: "What a customer earns when someone they sent you starts renting.", recommended: 2500, why: "Enough to notice, small enough to afford.", who: "finance", editor: "row" }),

  // ---- 4.4 rentals · Ending and renewing ----
  row({ key: "endingTermsPanel", section: "rentals", group: "Ending and renewing", label: "Ending terms", keywords: ["ending", "termination", "terms"], kind: "panel", what: "The fees and notice for ending a rental early, and the words customers agree to.", who: "finance", editor: { panelComponent: "TermsPolicyForm" }, covers: ["earlyTerminationFeeCents", "earlyTerminationFeePercent", "earlyTerminationFeeCapCents", "earlyTerminationNoticeDays", "unusedTermTreatment", "autoRenewNoticeDays", "autoRenewTermsVersion", "renewalTermsText", "terminationTermsText"] }),
  row({ key: "autoRenewPanel", section: "rentals", group: "Ending and renewing", label: "Automatic renewals", keywords: ["renew", "automatic", "roll over"], kind: "panel", what: "Whether rentals roll into a new term on their own when they end.", who: "owner", editor: { panelComponent: "AutoRenewSwitch" }, covers: ["autoRenewEnabled"] }),
  row({ key: "monthToMonthPanel", section: "rentals", group: "Ending and renewing", label: "Month-to-month rentals", keywords: ["month to month", "notice", "terms change"], kind: "panel", what: "How much notice a terms change needs on month-to-month rentals, and the words used.", who: "finance", editor: { panelComponent: "MonthToMonthForm" }, covers: ["monthToMonthChangeNoticeDays", "termsChangeNoticeText", "annualReminderText"] }),
  row({ key: "earlyReturnPanel", section: "rentals", group: "Ending and renewing", label: "When equipment comes back early", keywords: ["early return", "comes back"], kind: "panel", what: "How billing works when equipment comes back before the term ends.", who: "finance", editor: { panelComponent: "EarlyReturnForm" }, covers: ["earlyReturnBilling", "earlyReturnUnusedDays", "earlyReturnFee", "earlyReturnHandling"] }),
  row({ key: "rentalEndingsPanel", section: "rentals", group: "Ending and renewing", label: "Rental ending reminder", keywords: ["ending", "reminder", "notice days"], kind: "panel", what: "How far ahead a customer is reminded that their rental is ending.", who: "owner", editor: { panelHref: "/desk/settings/rental-endings" }, covers: ["rentalEndingNoticeDays"] }),
  row({ key: "noticesPanel", section: "rentals", group: "Ending and renewing", label: "Notices", keywords: ["notices", "hand delivery", "mail"], kind: "panel", what: "Who may hand-deliver a notice, and how many mail days to allow.", who: "finance", editor: { panelComponent: "NoticeDeliveryForm" }, covers: ["noticeCertifierRoles", "mailNoticeTransitDays"] }),

  // ---- 4.4 rentals · Pickups, visits, leads, retired ----
  row({ key: "pickupBillingPanel", section: "rentals", group: "Pickups and returns", label: "Pickup and return billing", keywords: ["pickup", "return", "late return", "billing"], kind: "panel", what: "How late returns, pickups and out-of-service time are billed.", who: "finance", editor: { panelComponent: "PickupBillingForm" }, covers: ["lateReturnRateMode", "lateReturnFixedDailyCents", "lateDeliveryProrationBasis", "earlyReturnProrationBasis", "pickupDayNotBilled", "outOfServiceEscalationDays"] }),
  row({ key: "jobSchedulingPanel", section: "rentals", group: "Visits", label: "Visit length and jobs", keywords: ["visit", "duration", "jobs", "schedule"], kind: "panel", what: "How long a visit usually takes, and whether staff may take unassigned visits.", who: "finance", editor: { panelComponent: "JobSchedulingForm" }, covers: ["defaultJobDurationMinutes", "staffMayWorkUnassignedJobs"] }),
  row({ key: "deliveryMorningStartHour", section: "rentals", group: "Visits", label: "Morning window starts", keywords: ["morning", "window", "delivery hours"], kind: "hours", min: 0, max: 23, what: "The hour the morning delivery window starts.", recommended: 8, why: "An 8 am start is early enough for most customers.", who: "finance", editor: "row" }),
  row({ key: "deliveryMorningEndHour", section: "rentals", group: "Visits", label: "Morning window ends", keywords: ["morning", "window", "delivery hours"], kind: "hours", min: 0, max: 23, what: "The hour the morning delivery window ends.", recommended: 12, why: "Midday splits the day into two windows.", who: "finance", editor: "row" }),
  row({ key: "deliveryAfternoonStartHour", section: "rentals", group: "Visits", label: "Afternoon window starts", keywords: ["afternoon", "window", "delivery hours"], kind: "hours", min: 0, max: 23, what: "The hour the afternoon delivery window starts.", recommended: 12, why: "Midday splits the day into two windows.", who: "finance", editor: "row" }),
  row({ key: "deliveryAfternoonEndHour", section: "rentals", group: "Visits", label: "Afternoon window ends", keywords: ["afternoon", "window", "delivery hours"], kind: "hours", min: 0, max: 23, what: "The hour the afternoon delivery window ends.", recommended: 17, why: "5 pm keeps evenings free.", who: "finance", editor: "row" }),
  row({ key: "leadScoringPanel", section: "rentals", group: "Leads and quotes", label: "Lead scoring", keywords: ["leads", "scoring", "points"], kind: "panel", what: "How new leads are scored so the most promising are answered first.", who: "finance", editor: { panelComponent: "LeadScoringForm" }, covers: ["leadScoringPolicy"] }),
  row({ key: "leadResponsePanel", section: "rentals", group: "Leads and quotes", label: "Lead response time", keywords: ["leads", "response", "speed"], kind: "panel", what: "How fast you aim to answer a new lead.", who: "owner", editor: { panelHref: "/desk/settings/lead-response" }, covers: ["leadResponseDays"] }),
  row({ key: "unsignedFollowUpPanel", section: "rentals", group: "Leads and quotes", label: "Unsigned rental reminder", keywords: ["unsigned", "reminder", "follow up"], kind: "panel", what: "When to remind a customer who has not signed yet.", who: "owner", editor: { panelHref: "/desk/settings/unsigned-follow-up" }, covers: ["unsignedFollowUpDays"] }),
  row({ key: "leadAssignmentLink", section: "rentals", group: "Leads and quotes", label: "Lead assignment", keywords: ["leads", "assignment", "who answers"], kind: "link", what: "Who new leads go to: you, or shared around the team.", who: "finance", editor: { panelHref: "/desk/leads" }, covers: ["leadAssignmentMode", "leadAssignmentUserId"] }),
  row({ key: "draftReservationHoldDays", section: "rentals", group: "Leads and quotes", label: "Days to hold a draft reservation", keywords: ["draft", "hold", "reservation", "days"], kind: "days", min: 0, max: 90, what: "How long a draft reservation holds its appliances before it lets go.", recommended: 7, why: "A week is long enough to decide without tying up machines.", who: "finance", editor: "row" }),
  row({ key: "retiredFollowUpDays", section: "rentals", group: "Retired appliances", label: "Retired appliance follow-up days", keywords: ["retired", "follow up", "sell"], kind: "days", min: 0, max: 365, what: "How long a retired appliance may sit before you are reminded to sell or scrap it.", recommended: 30, why: "A month keeps retired machines from being forgotten.", who: "finance", editor: { domainWriter: "setRetiredFollowUpDays" }, auditActions: ["settings.retired_follow_up_days"] }),
  row({ key: "tenantContactRetentionMonths", section: "rentals", group: "Property managers", label: "Months to keep a former tenant's contact details", keywords: ["tenant", "contact", "keep", "property manager"], kind: "number", min: 0, max: 120, what: "How long a former tenant's contact details are kept after they move out.", recommended: 12, why: "Keeps a former tenant's contact details long enough for move-out questions, then removes them.", who: "owner", editor: "row", feature: "propertyManagers" }),
];

export const SETTING_ROWS_PART2: SettingRowDef[] = [
  // ---- 4.5 team ----
  row({ key: "teamPanel", section: "team", label: "Team members", keywords: ["team", "staff", "invite", "people"], kind: "panel", what: "The people who can sign in, and inviting new ones.", who: "finance", editor: { panelComponent: "TeamSection" }, covers: ["invitationLinkDays", "adminsMayInviteStaff"] }),
  row({ key: "jobRolesPanel", section: "team", label: "Job roles", keywords: ["job roles", "screens", "who sees what"], kind: "panel", what: "What each job role can see and do in the desk.", who: "finance", editor: { panelComponent: "JobRolesEditor" } }),
  row({ key: "permissionsPanel", section: "team", label: "What each admin may do", keywords: ["permissions", "admin", "may do"], kind: "panel", what: "The extra powers each admin has, one by one.", who: "owner", editor: { panelHref: "/desk/settings/permissions" } }),
  row({ key: "approvalsPanel", section: "team", label: "Owner approval for large money actions", keywords: ["approval", "limits", "large", "money"], kind: "panel", what: "The amounts above which a money action needs your approval first.", who: "owner", editor: { panelHref: "/desk/settings/approvals" }, covers: ["approvalThresholds"] }),
  row({ key: "approvalExpiryDays", section: "team", label: "Days an approval request waits", keywords: ["approval", "expiry", "days", "waiting"], kind: "days", min: 1, max: 90, what: "How many days an approval request stays open before it lapses.", recommended: 7, why: "A week is long enough to decide without holding money up.", who: "owner", editor: { domainWriter: "setApprovalExpiryDays" }, auditActions: ["settings.approval_limits"] }),
  row({ key: "twoFactorPanel", section: "team", group: "Sign-in safety", label: "Two-step sign-in required for", keywords: ["two-step", "2fa", "security", "sign-in"], kind: "panel", what: "Which access levels must pass a second step at sign-in.", who: "owner", editor: { panelComponent: "TwoFactorPolicyPanel" }, covers: ["twoFactorRequiredRoles"] }),
  row({ key: "secondStepPanel", section: "team", group: "Sign-in safety", label: "Second-step methods", keywords: ["second step", "codes", "text", "authenticator"], kind: "panel", what: "Which kinds of sign-in codes each access level may use.", who: "owner", editor: { panelComponent: "SecondStepMethodsPanel" }, covers: ["secondStepMethodsByLevel", "securitySmsEnabled"] }),
  row({ key: "signInPausePanel", section: "team", group: "Sign-in safety", label: "Sign-in pause", keywords: ["pause", "wrong password", "lockout"], kind: "panel", what: "How many wrong passwords pause an account, and for how long.", who: "owner", editor: { panelComponent: "SignInPausePanel" }, covers: ["signInPauseAttempts", "signInPauseMinutes"] }),
  row({ key: "trustedDeviceDays", section: "team", group: "Sign-in safety", label: "Remember devices for (days)", keywords: ["remember", "device", "trusted"], kind: "days", min: 0, max: 90, what: "How long a remembered device skips the second step. 0 turns remembering off; an accountant is never remembered.", recommended: 30, why: "A month balances safety with not asking for a code every day.", who: "owner", editor: { domainWriter: "updateTrustedDeviceSettings" } }),

  // ---- 4.6 messages ----
  row({ key: "customerEmailPanel", section: "messages", label: "Email to customers", keywords: ["email", "customers", "send"], kind: "panel", what: "The master switch for emails to customers.", who: "owner", editor: { panelComponent: "CustomerEmailSwitch" }, covers: ["customerEmailEnabled"], auditActions: ["settings.customer_email_on", "settings.customer_email_off"] }),
  row({ key: "telecomPanel", section: "messages", label: "Text messages", keywords: ["text", "sms", "phone", "messages"], kind: "panel", what: "Texting customers: the switch, the wording policy, and what texts may be sent when.", who: "finance", editor: { panelHref: "/desk/settings/telecom" }, covers: ["customerSmsEnabled", "communicationsPolicy", "communicationsPolicyVersion", "marketingTextStartHour", "marketingTextEndHour"] }),
  row({ key: "paymentLinksPanel", section: "messages", label: "Payment link wording", keywords: ["payment link", "wording", "pay"], kind: "panel", what: "The words on the payment links you send customers.", who: "owner", editor: { panelHref: "/desk/settings/payment-links" }, covers: ["paymentLinkTemplates"] }),
  row({ key: "spanishPanel", section: "messages", label: "Spanish wording", keywords: ["spanish", "translation", "wording"], kind: "panel", what: "The Spanish wording on quotes, rentals and bills, and its reviews.", who: "finance", editor: { panelComponent: "SpanishReviewForm" }, covers: ["legalApprovals"], feature: "spanishDocuments" }),
  row({ key: "yourNotificationsLink", section: "messages", label: "Your notifications", keywords: ["notifications", "your", "bell"], kind: "link", what: "Each person chooses their own notifications.", who: "finance", editor: { panelHref: "/desk/account" } }),

  // ---- 4.7 money ----
  row({ key: "taxSetupLink", section: "money", label: "Tax setup", keywords: ["tax", "rates", "setup", "sales tax"], kind: "link", what: "Your tax rates, the fee and tax choices, and the price-vs-cost guard for service fees.", who: "finance", editor: { panelHref: "/desk/sales-tax/setup" }, covers: ["taxRatePermille", "taxRateMilliPercent", "shortTermLeaseElection", "shortTermLeaseElectionNote", "useTaxMonthlyThresholdCents", "retailDeliveryFeeDecision", "rdfThresholdCents", "rdfHandling", "businessTaxAddress", "autoApplyOfficialRateChanges", "watchOfficialTaxPages", "autoRateChangeMaxMilliPercent", "costlyChangeTimingPercent", "timingSafetyMarginBusinessDays", "serviceFeeCostLimitPercent", "selfInstallAllowedCategories", "truckCostPerMileCents", "laborCostPerMinuteCents", "businessUsePercents", "deMinimisElections", "enterpriseZone", "capitalizationPreference"] }),
  row({ key: "recordRetentionLink", section: "money", label: "How long records are kept", keywords: ["records", "kept", "retention", "years"], kind: "link", what: "How many years each kind of record is kept before it may be removed.", who: "finance", editor: { panelHref: "/desk/sales-tax/record-retention" }, covers: ["recordRetentionYears", "retentionAgreementYears", "retentionTaxYears", "retentionRefrigerantYears", "retentionLeadYears", "retentionMessageYears", "retentionPurgeEnabled"] }),
  row({ key: "booksSetupLink", section: "money", label: "Books setup", keywords: ["books", "setup", "start date", "wear and tear"], kind: "link", what: "When your books start, and how appliance wear-and-tear is spread by default.", who: "finance", editor: { panelHref: "/desk/books/setup" }, covers: ["booksStartDate", "booksReviewReminderDay", "depreciationMonthsDefault", "depreciationSalvagePercent", "badDebtTaxRecovery"] }),
  row({ key: "budgetLink", section: "money", label: "Budget", keywords: ["budget", "envelopes", "spending"], kind: "link", what: "Your budget envelopes and how far ahead they plan.", who: "finance", editor: { panelHref: "/desk/books/budget" }, covers: ["cashBudgetStartOn", "cashBudgetEnabled", "bankEvidenceMaxAgeDays", "budgetPlanningHorizonDays", "budgetUpcomingWindowDays", "budgetReminderLeadDays"], feature: "budget" }),
  row({ key: "collectionsLink", section: "money", label: "Collections", keywords: ["collections", "notices", "unpaid", "dispute"], kind: "link", what: "When unpaid bills get their notices, and the words those notices use.", who: "finance", editor: { panelHref: "/desk/collections" }, covers: ["achDisputeWindowDays", "collectionSecondNoticeDay", "collectionFinalNoticeDay", "collectionPayHowText", "collectionHelpText", "collectionDecisionDay"] }),
  row({ key: "receiptFileKeepDays", section: "money", label: "Days to keep a removed receipt file", keywords: ["receipt", "file", "keep", "days"], kind: "days", min: 0, max: 365, what: "How long a receipt file you removed is kept before it is gone for good.", recommended: 30, why: "A month is long enough to undo a mistake.", who: "finance", editor: "row" }),
  row({ key: "unsentPhotoKeepDays", section: "money", label: "Days to keep a photo removed before sending", keywords: ["photo", "keep", "days", "removed"], kind: "days", min: 0, max: 365, what: "How long a photo removed before sending is kept before it is gone for good.", recommended: 1, why: "Photos removed before sending rarely need keeping.", who: "finance", editor: "row" }),
  row({ key: "lemonRepairPercent", section: "money", label: "Flag an appliance when repairs reach this share of its rent", keywords: ["repairs", "lemon", "flag", "share"], kind: "percent", min: 5, max: 100, what: "When an appliance's repair costs reach this share of what it earns, it is flagged for a second look.", recommended: 30, why: "Repairs costing more than about a third of what an appliance earns usually mean it should be replaced.", who: "finance", editor: "row" }),
  row({ key: "exportPayoutLines", section: "money", label: "Include payouts in accounting exports", keywords: ["exports", "quickbooks", "xero", "csv", "payouts", "accountant"], kind: "choice", what: "Which accounting exports include the payout lines from your card payments.", recommended: { QBO_JOURNAL_CSV: true, XERO_JOURNAL_CSV: false, GENERIC_JOURNAL_CSV: true, CASH_MOVEMENTS_CSV: true }, why: "On for QuickBooks and plain files, off for Xero, until you say otherwise.", who: "finance", editor: "row", feature: "accountantExports", choices: [{ value: "QBO_JOURNAL_CSV", label: "QuickBooks" }, { value: "XERO_JOURNAL_CSV", label: "Xero" }, { value: "GENERIC_JOURNAL_CSV", label: "Plain CSV" }, { value: "CASH_MOVEMENTS_CSV", label: "Cash movements" }] }),

  // ---- 4.8 website ----
  row({ key: "websiteEditorLink", section: "website", label: "Edit the website", keywords: ["website", "edit", "pages"], kind: "link", what: "The words and pictures on your public website.", who: "finance", editor: { panelHref: "/desk/settings/website" } }),
  row({ key: "launchListLink", section: "website", label: "Launch list", keywords: ["launch", "list", "waiting"], kind: "link", what: "The people waiting to hear when you open.", who: "finance", editor: { panelHref: "/desk/launch" } }),
  row({ key: "viewWebsiteLink", section: "website", label: "View the website", keywords: ["view", "website", "public"], kind: "link", what: "Open the public website the way a customer sees it.", who: "finance", editor: { panelHref: "/" } }),

  // ---- 4.9 advanced ----
  row({ key: "systemHealthLink", section: "advanced", label: "System health", keywords: ["system", "health", "automations", "backups"], kind: "link", what: "Whether the app's background jobs are healthy, and the backup and timing settings edited there.", who: "finance", editor: { panelHref: "/desk/automations" }, covers: ["pausedAutomations", "automationLateGraceMinutes", "backupRetentionDays"] }),
  row({ key: "switchesPanel", section: "advanced", label: "All switches in one place", keywords: ["switches", "all", "list"], kind: "panel", what: "Every on/off switch in the business, in one read-only list.", who: "finance", editor: { panelHref: "/desk/settings/switches" } }),
  row({ key: "historyPanel", section: "advanced", label: "Settings history and undo", keywords: ["history", "undo", "changes"], kind: "panel", what: "Every settings change, who made it, and undo where it is safe.", who: "finance", editor: { panelHref: "/desk/settings/history" } }),
  row({ key: "featuresPanel", section: "advanced", label: "Features", keywords: ["features", "show", "hide"], kind: "panel", what: "Which parts of the desk are shown, so the app stays as simple as your business needs.", who: "owner", editor: { panelHref: "/desk/settings/features" }, covers: ["shownFeatures"] }),
  row({ key: "privacyLink", section: "advanced", label: "Privacy requests", keywords: ["privacy", "requests", "data"], kind: "link", what: "Requests from people about their own information.", who: "owner", editor: { panelHref: "/desk/privacy" } }),
  row({ key: "previewStorageLink", section: "advanced", label: "Preview storage check", keywords: ["preview", "storage", "check"], kind: "link", what: "A check that document previews are stored the way they should be.", who: "owner", editor: { panelHref: "/desk/settings/preview-storage" } }),
  row({ key: "connectedServicesPanel", section: "advanced", label: "Connected services", keywords: ["connected", "services", "providers"], kind: "panel", what: "The outside services the app talks to, and whether each is set up.", who: "finance", editor: { panelComponent: "ProviderStatusPanel" } }),
  row({ key: "activityLink", section: "advanced", label: "Activity log", keywords: ["activity", "log", "audit"], kind: "link", what: "Everything that has happened in the desk, in order.", who: "finance", editor: { panelHref: "/desk/activity" } }),
  row({ key: "feedbackLink", section: "advanced", label: "App feedback", keywords: ["feedback", "reports", "bugs"], kind: "link", what: "Feedback and problem reports from people using the app, and how long they stay open.", who: "finance", editor: { panelHref: "/desk/feedback" }, covers: ["feedbackMaxAttachments", "feedbackReopenDays"] }),
  row({ key: "vaultLink", section: "advanced", label: "Logins vault and emergency access", keywords: ["vault", "logins", "passwords", "emergency"], kind: "link", what: "Your logins vault, and who can ask for emergency access if you cannot sign in.", who: "owner", editor: { panelHref: "/desk/vault" }, covers: ["emergencyAccessEnabled", "emergencyContactName", "emergencyContactEmail", "emergencyContactPhone", "emergencyWaitDays"] }),
  row({ key: "continuityPanel", section: "advanced", label: "Business continuity plan", keywords: ["continuity", "successor", "emergency", "if something happens"], kind: "panel", what: "Who steps in if something happens to you: your emergency contact, successor, CPA and attorney.", who: "owner", editor: { panelHref: "/desk/continuity" }, covers: ["continuityEmergencyName", "continuityEmergencyContact", "continuitySuccessorName", "continuitySuccessorContact", "continuityCpaName", "continuityCpaContact", "continuityAttorneyName", "continuityAttorneyContact", "continuityRecordsNote"] }),
];

/** Every row, in section order. */
export const ALL_SETTING_ROWS: SettingRowDef[] = [...SETTING_ROWS, ...SETTING_ROWS_PART2];

export const NOT_A_SETTING: Record<string, string> = {
  id: "The settings row's own id.",
  updatedAt: "Kept up by the database itself.",
  setupFeeTaxConfirmedOn: "Recorded by the setup-fee tax decision.",
  setupFeeTaxApprovedAt: "Recorded by the setup-fee tax decision.",
  setupFeeTaxEffectiveFrom: "Recorded by the setup-fee tax decision.",
  setupFeeTaxAdviserReference: "Recorded by the setup-fee tax decision.",
  setupFeeTaxDecisionNote: "Recorded by the setup-fee tax decision.",
  rdfCpaConfirmedOn: "Recorded by the delivery-fee decision.",
  rdfThresholdCrossedOn: "Recorded by the delivery-fee check.",
  drivingOriginVerifiedAt: "Recorded with the origin when it is checked.",
  drivingOriginSourceReference: "Recorded with the origin when it is checked.",
  tenantContactPurgeApprovedAt: "Approval evidence for a contact cleanup.",
  tenantContactPurgeApprovalReference: "Approval evidence for a contact cleanup.",
  tenantContactPurgeApprovedBy: "Approval evidence for a contact cleanup.",
  taxRateConfirmed: "Recorded by tax setup when a rate is confirmed.",
  inspectionChecklist: "Edited on the appliance record, not in Settings.",
  announcementBannerText: "Replaced by the website's Featured promotion.",
  announcementBannerOn: "Replaced by the website's Featured promotion.",
  booksLastBroughtUpToDateAt: "Recorded by the nightly books job.",
  booksLastProblemCount: "Recorded by the nightly books check.",
  booksConsecutiveFailedNights: "Recorded by the nightly books check.",
  accountantChangesSeenAt: "The owner's last-looked marker for the accountant changes feed.",
  accountantEmail: "Kept with the accountant's sign-in, not a Settings screen.",
  decisionsReviewedAt: "The owner's last-looked marker for Decisions & reviews.",
  leadRotationCursor: "The lead rotation's working state, not a choice.",
  chargesPausedAt: "Recorded when charges are paused from the billing screen.",
  chargesPausedByUserId: "Recorded when charges are paused from the billing screen.",
  chargesPausedNote: "Recorded when charges are paused from the billing screen.",
  continuityReviewedAt: "Recorded when the continuity plan is reviewed.",
  ucccNotificationFiledOn: "Recorded when the notification is filed.",
  faceMatchIdEnabled: "No screen operates this today; it waits for its own rollout.",
};

export function settingRowByKey(key: string): SettingRowDef | undefined {
  return ALL_SETTING_ROWS.find((r) => r.key === key);
}

export function rowsForSection(section: SettingsSectionId): SettingRowDef[] {
  return ALL_SETTING_ROWS.filter((r) => r.section === section);
}

/** Every BusinessSettings field a row edits directly or a panel/link covers. */
export function coveredSettingFields(): Set<string> {
  const out = new Set<string>();
  for (const r of ALL_SETTING_ROWS) {
    if (r.editor === "row" || typeof r.editor === "object" && "domainWriter" in r.editor) out.add(r.key);
    for (const f of r.covers ?? []) out.add(f);
  }
  return out;
}
