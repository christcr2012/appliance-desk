"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { jobRoleScreens } from "@/lib/job-role-guard";
import {
  approveFiling,
  markFilingDoneElsewhere,
  markFilingNotApplicable,
  prepareFiling,
  markFilingReviewed,
  resolveFiling,
  submitFiling,
} from "@/domains/compliance/filings";
import { saveBusinessFacts, ENTITY_TYPES, type EntityType } from "@/domains/compliance/profile";
import { saveTaxYearFacts } from "@/domains/compliance/tax-facts";
import { dollarsToCents } from "@/domains/pricing/money";
import { obligationByKey } from "@/domains/compliance/registry";
import { getComplianceProfile } from "@/domains/compliance/profile";
import { businessDateKey } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";

// CMP-1: Compliance screen actions. Reads are OWNER/ADMIN; approvals and
// submissions are OWNER-only in the domain. Staff job roles narrow by the
// Taxes screen (compliance rides the sales-tax screen), checked explicitly
// here like the Leads actions — a server action can be posted from anywhere.

export type ComplianceActionState = { error?: string; ok?: boolean };

const message = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Try again.";

/**
 * Compliance rides the Taxes (sales-tax) job-role screen. A server action
 * can be posted from any page, so the screen is checked explicitly here —
 * the same lesson the Leads actions carry.
 */
async function requireTaxesScreen(user: { id: string; role: string }): Promise<void> {
  const screens = await jobRoleScreens(user.id, user.role);
  if (screens !== null && !screens.includes("sales-tax")) {
    throw new Error("Your job role doesn't include the Taxes screen.");
  }
}

export async function saveFactsAction(
  _prev: ComplianceActionState,
  formData: FormData,
): Promise<ComplianceActionState> {
  try {
    const { user } = await requireRole("OWNER");
    const entityType = String(formData.get("entityType") ?? "");
    if (!(ENTITY_TYPES as readonly string[]).includes(entityType)) {
      return { error: "Choose the business type." };
    }
    const einField = formData.get("ein");
    const clearEin = formData.get("clearEin") === "on";
    const month = String(formData.get("sosReportMonth") ?? "").trim();
    const gvwr = String(formData.get("truckGvwrLbs") ?? "").trim();
    await saveBusinessFacts(user.id, {
      entityType: entityType as EntityType,
      ein: clearEin ? null : typeof einField === "string" && einField.trim() !== "" ? einField : undefined,
      sosReportMonth: month === "" ? null : Number(month),
      truckGvwrLbs: gvwr === "" ? null : Number(gvwr),
      employees: Number(String(formData.get("employees") ?? "0")) || 0,
      hasHomeOffice: formData.get("hasHomeOffice") === "on",
      payer: {
        businessLegalName: String(formData.get("businessLegalName") ?? "").trim() || null,
        businessAddress: String(formData.get("businessAddress") ?? "").trim() || null,
        businessCity: String(formData.get("businessCity") ?? "").trim() || null,
        businessState: String(formData.get("businessState") ?? "").trim().toUpperCase() || null,
        businessZip: String(formData.get("businessZip") ?? "").trim() || null,
        businessPhone: String(formData.get("businessPhone") ?? "").trim() || null,
      },
      local: {
        tradeName: String(formData.get("tradeName") ?? "").trim() || null,
        usdotNumber: String(formData.get("usdotNumber") ?? "").trim() || null,
        truckRegistrationMonth:
          String(formData.get("truckRegistrationMonth") ?? "").trim() === ""
            ? null
            : Number(String(formData.get("truckRegistrationMonth"))),
        greeleyLicenseDate: String(formData.get("greeleyLicenseDate") ?? "").trim() || null,
        registeredAgentName: String(formData.get("registeredAgentName") ?? "").trim() || null,
        registeredAgentAddress: String(formData.get("registeredAgentAddress") ?? "").trim() || null,
        registeredAgentCity: String(formData.get("registeredAgentCity") ?? "").trim() || null,
        registeredAgentState: String(formData.get("registeredAgentState") ?? "").trim().toUpperCase() || null,
        registeredAgentZip: String(formData.get("registeredAgentZip") ?? "").trim() || null,
      },
    });
    // New facts can make new obligations apply (or schedule ones that were
    // waiting on a fact) — refresh the filing rows right away.
    const { syncComplianceFilings } = await import("@/domains/compliance/filings");
    await syncComplianceFilings();
    revalidatePath("/desk/compliance");
    revalidatePath("/desk/compliance/facts");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

/** The SOS periodic report's guided preparation: the exact values to type. */
/** CMP-2: save one finished year's tax figures (Business facts). */
export async function saveTaxYearFactsAction(
  _prev: ComplianceActionState,
  formData: FormData,
): Promise<ComplianceActionState> {
  try {
    const { user } = await requireRole("OWNER");
    const year = Number(String(formData.get("taxYear") ?? ""));
    const money = (name: string): number | null => {
      const raw = String(formData.get(name) ?? "").replace(/[$,]/g, "").trim();
      if (raw === "") return null;
      if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new Error("Enter amounts as dollars, like 4200 or 4200.50.");
      return dollarsToCents(Number(raw));
    };
    await saveTaxYearFacts(user.id, year, {
      federalTaxCents: money("federalTax"),
      federalAgiCents: money("federalAgi"),
      coloradoTaxCents: money("coloradoTax"),
      form1099KGrossCents: money("form1099KGross"),
    });
    revalidatePath("/desk/compliance/facts");
    revalidatePath("/desk/compliance");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function prepareGuidedAction(filingId: string): Promise<ComplianceActionState> {
  try {
    const { user } = await requireRole("OWNER", "ADMIN", "ACCOUNTANT");
    await requireTaxesScreen(user);
    const { prisma } = await import("@/lib/prisma");
    const filing = await prisma.complianceFiling.findUnique({ where: { id: filingId } });
    if (!filing) return { error: "That filing no longer exists." };
    const obligation = obligationByKey(filing.obligationKey);
    // CMP-3: the 1099 filings prepare from the year's books.
    if (filing.obligationKey === "fed.1099_nec" || filing.obligationKey === "fed.1099_misc") {
      const { build1099PreparedData } = await import("@/domains/compliance/information-returns");
      const data = await build1099PreparedData(filing);
      if (!data) return { error: "That filing's year could not be read." };
      await prepareFiling(user.id, filingId, data);
      revalidatePath(`/desk/compliance/${filingId}`);
      revalidatePath("/desk/compliance");
      return { ok: true };
    }
    // CMP-3: a Form 8300 filing prepares from the triggering cash receipt.
    if (filing.obligationKey === "fed.8300") {
      const data = (filing.preparedData ?? {}) as { totalCashCents?: number; receivedOn?: string; dueBy?: string };
      await prepareFiling(user.id, filingId, {
        // The detector's fields ride along — the filled form is built from them.
        ...data,
        what: "Form 8300 — cash over $10,000 from one customer. Download the filled draft, check it, and file it on the BSA E-Filing system.",
        totalCashReceived: data.totalCashCents !== undefined ? formatMoney(data.totalCashCents) : "see the receipt",
        cashReceivedOn: data.receivedOn ?? "",
        fileBy: data.dueBy ?? businessDateKey(filing.dueOn),
      });
      revalidatePath(`/desk/compliance/${filingId}`);
      revalidatePath("/desk/compliance");
      return { ok: true };
    }
    // CMP-2: the Schedule C accountant packet, from the year's books.
    if (filing.obligationKey === "fed.income.schedule_c") {
      const { yearOfPeriodKey } = await import("@/domains/compliance/estimates");
      const { computeScheduleCYear } = await import("@/domains/compliance/schedule-c");
      const { compute1099KTieOut } = await import("@/domains/compliance/k-reconciliation");
      const { build4562Worksheet, build4797Worksheet } = await import("@/domains/compliance/worksheets");
      const year = yearOfPeriodKey(filing.periodKey);
      if (year === null) return { error: "That filing's year could not be read." };
      const profile = await getComplianceProfile();
      await prepareFiling(user.id, filingId, {
        year,
        scheduleC: await computeScheduleCYear(year),
        tieOut: await compute1099KTieOut(year),
        worksheet4562: await build4562Worksheet(year),
        worksheet4797: await build4797Worksheet(year),
        homeOffice: profile.hasHomeOffice,
      } as unknown as Record<string, unknown>);
      revalidatePath(`/desk/compliance/${filingId}`);
      revalidatePath("/desk/compliance");
      return { ok: true };
    }
    // CMP-2: the two worksheets prepare on their own filings too.
    if (filing.obligationKey === "fed.4562" || filing.obligationKey === "fed.4797") {
      const { yearOfPeriodKey } = await import("@/domains/compliance/estimates");
      const { build4562Worksheet, build4797Worksheet } = await import("@/domains/compliance/worksheets");
      const year = yearOfPeriodKey(filing.periodKey);
      if (year === null) return { error: "That filing's year could not be read." };
      await prepareFiling(
        user.id,
        filingId,
        filing.obligationKey === "fed.4562"
          ? { year, worksheet4562: await build4562Worksheet(year) }
          : { year, worksheet4797: await build4797Worksheet(year) },
      );
      revalidatePath(`/desk/compliance/${filingId}`);
      revalidatePath("/desk/compliance");
      return { ok: true };
    }
    // CMP-2: quarterly estimates by the safe-harbor method.
    if (filing.obligationKey === "fed.estimated_tax" || filing.obligationKey === "co.income.dr0104ep") {
      const { estimateQuarterlyTax, quarterOfPeriodKey, yearOfPeriodKey } = await import("@/domains/compliance/estimates");
      const year = yearOfPeriodKey(filing.periodKey);
      const quarter = quarterOfPeriodKey(filing.periodKey);
      if (year === null || quarter === null) return { error: "That filing's quarter could not be read." };
      const federal = filing.obligationKey === "fed.estimated_tax";
      const estimate = await estimateQuarterlyTax(year, quarter, federal ? "FEDERAL" : "COLORADO");
      await prepareFiling(user.id, filingId, {
        ...estimate,
        payUrl: federal ? "https://www.irs.gov/payments/direct-pay" : "https://www.colorado.gov/revenueonline",
        payLabel: federal ? "IRS Direct Pay" : "Colorado Revenue Online",
      });
      revalidatePath(`/desk/compliance/${filingId}`);
      revalidatePath("/desk/compliance");
      return { ok: true };
    }
    // CMP-4: the Weld property declaration, from the January 1 snapshot.
    // An under-exemption verdict does NOT close the filing here: the
    // snapshot totals the property the app tracks, and other business
    // property could still take the real total over the line. The
    // filing stays ready for review; the owner confirms "this is
    // everything" on the filing page to close it as not needed (the
    // BppSection confirm), or approves it and files with the rest
    // added by hand.
    if (filing.obligationKey === "co.bpp.weld_declaration") {
      const { buildBppPreparedData } = await import("@/domains/compliance/bpp");
      const profile = await getComplianceProfile();
      const data = await buildBppPreparedData(filing, profile);
      await prepareFiling(user.id, filingId, data);
      revalidatePath(`/desk/compliance/${filingId}`);
      revalidatePath("/desk/compliance");
      return { ok: true };
    }
    // CMP-4: the Greeley license renewal values.
    if (filing.obligationKey === "greeley.business_license") {
      const profile = await getComplianceProfile();
      await prepareFiling(user.id, filingId, {
        what: "Greeley business license renewal, on the city's sales tax portal (linked from this filing's source). There is no fee.",
        ...(profile.businessLegalName ? { legalName: profile.businessLegalName } : {}),
        ...(profile.greeleyLicenseDate
          ? { licenseDate: businessDateKey(profile.greeleyLicenseDate) }
          : {}),
        renewBy: businessDateKey(filing.dueOn),
      });
      revalidatePath(`/desk/compliance/${filingId}`);
      revalidatePath("/desk/compliance");
      return { ok: true };
    }
    // CMP-4: the truck registration renewal values.
    if (filing.obligationKey === "co.vehicle_registration") {
      const profile = await getComplianceProfile();
      await prepareFiling(user.id, filingId, {
        what: "Truck registration renewal at the Weld County motor vehicle office, or online through the Colorado DMV. Bring the current registration card and proof of insurance; the specific ownership tax is figured at the counter.",
        ...(profile.truckRegistrationMonth ? { registrationMonth: profile.truckRegistrationMonth } : {}),
        renewBy: businessDateKey(filing.dueOn),
      });
      revalidatePath(`/desk/compliance/${filingId}`);
      revalidatePath("/desk/compliance");
      return { ok: true };
    }
    // CMP-4: the USDOT biennial update values.
    if (filing.obligationKey === "fed.usdot") {
      const { usdotScheduleWords } = await import("@/domains/compliance/local-schedules");
      const profile = await getComplianceProfile();
      await prepareFiling(user.id, filingId, {
        what: "USDOT biennial update on the FMCSA site. The update itself is free — never pay a company that mails or emails you a form for it.",
        ...(profile.usdotNumber ? { usdotNumber: profile.usdotNumber } : {}),
        ...(usdotScheduleWords(profile.usdotNumber)
          ? { schedule: usdotScheduleWords(profile.usdotNumber) }
          : {}),
        updateBy: businessDateKey(filing.dueOn),
      });
      revalidatePath(`/desk/compliance/${filingId}`);
      revalidatePath("/desk/compliance");
      return { ok: true };
    }
    if (filing.obligationKey !== "co.sos.periodic_report") {
      return {
        error: `This filing is prepared by ${obligation?.unit ?? "a later step"} — it isn't ready to prepare here yet.`,
      };
    }
    const profile = await getComplianceProfile();
    if (!profile.sosReportMonth) {
      return { error: "Add your LLC's report month in Business facts first." };
    }
    // CMP-4: the exact values to type on the SOS site — the legal name,
    // the principal office (the CMP-3 payer identity) and the registered
    // agent, each included only when it is actually recorded.
    const principalOffice = [
      profile.businessAddress,
      profile.businessCity,
      profile.businessState,
      profile.businessZip,
    ]
      .filter(Boolean)
      .join(", ");
    const registeredAgent = profile.registeredAgentName
      ? [
          profile.registeredAgentName,
          profile.registeredAgentAddress,
          profile.registeredAgentCity,
          profile.registeredAgentState,
          profile.registeredAgentZip,
        ]
          .filter(Boolean)
          .join(", ")
      : "";
    const stillNeeded = [
      !profile.businessLegalName && "the LLC's legal name",
      !principalOffice && "the principal office address",
      !registeredAgent && "the registered agent's name and address",
    ].filter(Boolean) as string[];
    await prepareFiling(user.id, filingId, {
      what: "Colorado LLC periodic report, filed on the Secretary of State site",
      reportMonth: profile.sosReportMonth,
      fileBetween: `${businessDateKey(filing.actOn)} and ${businessDateKey(filing.dueOn)}`,
      fee: "$25, paid to the Secretary of State",
      ...(profile.businessLegalName ? { legalName: profile.businessLegalName } : {}),
      ...(principalOffice ? { principalOffice } : {}),
      ...(registeredAgent ? { registeredAgent } : {}),
      ...(stillNeeded.length
        ? { stillNeeded: `Add ${stillNeeded.join(", ")} in Business facts so they show here.` }
        : {}),
    });
    revalidatePath(`/desk/compliance/${filingId}`);
    revalidatePath("/desk/compliance");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function markReviewedAction(filingId: string): Promise<ComplianceActionState> {
  try {
    const { user } = await requireRole("OWNER", "ADMIN", "ACCOUNTANT");
    await requireTaxesScreen(user);
    await markFilingReviewed(user.id, filingId);
    revalidatePath(`/desk/compliance/${filingId}`);
    revalidatePath("/desk/compliance");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function approveAction(filingId: string, preparedHash: string): Promise<ComplianceActionState> {
  try {
    const { user } = await requireRole("OWNER");
    await approveFiling(user.id, filingId, preparedHash);
    revalidatePath(`/desk/compliance/${filingId}`);
    revalidatePath("/desk/compliance");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function approveAndSubmitAction(
  filingId: string,
  preparedHash: string,
  confirmation: string,
): Promise<ComplianceActionState> {
  try {
    const { user } = await requireRole("OWNER");
    await approveFiling(user.id, filingId, preparedHash);
    await submitFiling(user.id, filingId, confirmation || undefined);
    revalidatePath(`/desk/compliance/${filingId}`);
    revalidatePath("/desk/compliance");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function markSubmittedAction(
  filingId: string,
  confirmation: string,
): Promise<ComplianceActionState> {
  try {
    const { user } = await requireRole("OWNER");
    await submitFiling(user.id, filingId, confirmation || undefined);
    revalidatePath(`/desk/compliance/${filingId}`);
    revalidatePath("/desk/compliance");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function resolveAction(
  filingId: string,
  outcome: "ACCEPTED" | "REJECTED",
): Promise<ComplianceActionState> {
  try {
    const { user } = await requireRole("OWNER", "ADMIN");
    await requireTaxesScreen(user);
    await resolveFiling(user.id, filingId, outcome);
    revalidatePath(`/desk/compliance/${filingId}`);
    revalidatePath("/desk/compliance");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function doneElsewhereAction(filingId: string): Promise<ComplianceActionState> {
  try {
    const { user } = await requireRole("OWNER");
    await markFilingDoneElsewhere(user.id, filingId);
    revalidatePath(`/desk/compliance/${filingId}`);
    revalidatePath("/desk/compliance");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function notApplicableAction(filingId: string, note: string): Promise<ComplianceActionState> {
  try {
    const { user } = await requireRole("OWNER", "ADMIN");
    await requireTaxesScreen(user);
    await markFilingNotApplicable(user.id, filingId, note || "Marked not needed.");
    revalidatePath(`/desk/compliance/${filingId}`);
    revalidatePath("/desk/compliance");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

/** CMP-3: classify an expense category for 1099 reporting (never guessed). */
export async function classifyCategoryAction(
  filingId: string,
  categoryId: string,
  box: string,
): Promise<ComplianceActionState> {
  try {
    const { user } = await requireRole("OWNER", "ADMIN");
    await requireTaxesScreen(user);
    const { setCategory1099Box, refresh1099Preparation } = await import("@/domains/compliance/information-returns");
    await setCategory1099Box(user.id, categoryId, box === "" ? null : (box as "NEC_1" | "MISC_1" | "MISC_3"));
    // The filing's prepared numbers must include the classification before
    // the owner can approve them — refresh in place when it's waiting for
    // review (PR #654 review finding).
    await refresh1099Preparation(user.id, filingId);
    revalidatePath(`/desk/compliance/${filingId}`);
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}
