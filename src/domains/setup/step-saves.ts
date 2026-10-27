import { prisma } from "@/lib/prisma";
import { businessDateKey } from "@/lib/business-date";
import { ensureStarterRecord, updatePaperwork } from "@/domains/paperwork";
import { attachRecordFile } from "@/domains/paperwork/records";
import { paperworkInputSchema } from "@/domains/paperwork/schema";
import { getStep } from "./walkthroughs";
import { markStepDone } from "./guide";

/**
 * SETUP-1: saving what a step produced (a number, a file) onto its business
 * record. Kept apart from guide.ts on purpose: this module pulls in the
 * records domain (and with it the blob storage client), while guide.ts —
 * state, checks, progress — is imported by the exceptions index and must
 * stay light enough for every screen that lists To dos.
 */

/**
 * Save the number a step produced onto its business record (created from the
 * starter template first if needed), through the paperwork domain so the
 * number is validated, encrypted and audited exactly like the Records
 * screen does it. Then mark the step done.
 */
export async function saveStepNumber(
  userId: string,
  walkthroughKey: string,
  stepKey: string,
  numberValue: string,
): Promise<void> {
  const found = getStep(walkthroughKey, stepKey);
  if (!found?.step.record?.fields.includes("number")) {
    throw new Error("That step doesn't take a number.");
  }
  const templateKey = found.step.record.templateKey;
  const recordId = await ensureStarterRecord(userId, templateKey);
  const row = await prisma.businessPaperwork.findUniqueOrThrow({ where: { id: recordId } });
  const input = paperworkInputSchema.parse({
    title: row.title,
    groupName: row.groupName,
    whatItIs: row.whatItIs,
    agency: row.agency ?? undefined,
    officialUrl: row.officialUrl ?? undefined,
    status: row.status,
    startedOn: row.startedOn ? businessDateKey(row.startedOn) : undefined,
    dueOn: row.dueOn ? businessDateKey(row.dueOn) : undefined,
    referenceNumber: row.referenceNumber ?? undefined,
    notes: row.notes ?? undefined,
    remindDaysBefore: row.remindDaysBefore,
    repeatEveryMonths: row.repeatEveryMonths ?? undefined,
    kind: row.kind,
    issuedOn: row.issuedOn ? businessDateKey(row.issuedOn) : undefined,
    expiresOn: row.expiresOn ? businessDateKey(row.expiresOn) : undefined,
    numberLabel: row.numberLabel ?? undefined,
    numberValue,
    portalUrl: row.portalUrl ?? undefined,
    costDollars:
      row.costCents != null
        ? `${Math.floor(row.costCents / 100)}.${String(row.costCents % 100).padStart(2, "0")}`
        : undefined,
    linkedObligationKeys: row.linkedObligationKeys,
  });
  await updatePaperwork(userId, recordId, input, row.version);
  await markStepDone(userId, walkthroughKey, stepKey);
}

/**
 * Attach the file a step produced to its business record (created first if
 * needed) through the records domain — magic bytes, private storage and
 * audit all come from there. Then mark the step done.
 */
export async function saveStepFile(
  userId: string,
  walkthroughKey: string,
  stepKey: string,
  file: { fileName: string; bytes: Uint8Array; label?: string },
): Promise<void> {
  const found = getStep(walkthroughKey, stepKey);
  if (!found?.step.record?.fields.includes("file")) {
    throw new Error("That step doesn't take a file.");
  }
  const recordId = await ensureStarterRecord(userId, found.step.record.templateKey);
  await attachRecordFile(userId, recordId, file);
  await markStepDone(userId, walkthroughKey, stepKey);
}
