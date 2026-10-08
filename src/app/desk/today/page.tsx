import {
  getExceptionOverview,
  getTodaysJobs,
  type ExceptionCategory,
} from "@/domains/exceptions";
import {
  manuallyApplyObservedRate,
  undoAutoAppliedRateVersion,
} from "@/domains/tax/official-rate-auto-apply";
import { acknowledgeOfficialSourceChange } from "@/domains/tax/official-source-watch";
import { getDueTaskSummary } from "@/domains/tasks/workspace";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import {
  businessDateKey,
  formatBusinessDate,
  formatBusinessTime,
} from "@/lib/business-date";
import { jobTypeLabel } from "@/lib/status-labels";
import { revalidatePath } from "next/cache";
import {
  AttentionList,
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  StatCard,
  VisitRow,
} from "@/components/ui";
import { TaskRow } from "../tasks/task-row";

export const metadata = { title: "Today" };

async function acknowledgeTaxSourceAction(formData: FormData) {
  "use server";
  const watchId = formData.get("watchId");
  const watchVersion = formData.get("watchVersion");
  if (
    typeof watchId !== "string" ||
    !watchId ||
    watchId.length > 200 ||
    typeof watchVersion !== "string" ||
    !/^[a-f0-9]{64}:\d{1,16}$/.test(watchVersion)
  ) {
    return;
  }
  await acknowledgeOfficialSourceChange(watchId, watchVersion);
  revalidatePath("/desk/today");
}

async function undoOfficialRateAction(formData: FormData) {
  "use server";
  const session = await requireRole("OWNER");
  const rateVersionId = formDa¶»§q«^