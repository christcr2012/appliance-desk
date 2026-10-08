import { deliverMessage } from "@/domains/messaging/deliver";
import { getBusinessSettings } from "@/domains/settings";
import {
  businessDateKey,
  businessDayBounds,
} from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { assertActiveTeamActor } from "@/lib/team-actor";

import { listActiveOfficialSourceWatches } from "./official-rate-metadata";
import { fetchOfficialSourcePage } from "./safe-official-source-fetch";

const CPA_REMINDER_TEXT =
  "Ask your CPA whether anything in Colorado sales tax changes on January 1 for you";

export type OfficialSourceWatchRun = {
  checked: number;
  changed: number;
  recovered: number;
  failed: number;
};

function isColoradoMonday(now: Date): boolean {
  const key = businessDateKey(now);
  return new Date(`${key}T12:00:00.000Z`).getUTCDay() === 1;
}

function sanitizeError(cause: unknown): string {
  const raw =
    cause instanceof Error
      ? `${cause.name}: ${cause.message}`
      : "Unknown official-source failure";
  return raw
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[address]")
    .replace(/\b[A-F0-9:]{3,}\b/gi, "[address]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]")
    .slice(0, 500);
}

function compactExcerptText(lines: string[]): string {
  return lines.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function firstCharacterDifference(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function excerptWindow(value: string, center: number, maxLength = 300): string {
  if (!value) return "";
  if (value.length <= maxLength) return value;

  const half = Math.floor(maxLength / 2);
  let start = Math.max(0, center - half);
  let end = Math.min(value.length, start + maxLength);
  if (end - start < maxLength) start = Math.max(0, end - maxLength);

  return `${start > 0 ? "…" : ""}${value.slice(start, end).trim()}${
    end < value.length ? "…" : ""
  }`;
}

function capExcerpt(value: string): string {
  if (value.length <= 700) return value;
  return `${value.slice(0, 697).trimEnd()}…`;
}

export function buildOfficialSourceChangeExcerpt(
  previousText: string | null,
  currentText: string,
): string {
  if (!previousText) {
    const added = compactExcerptText(currentText.split("\n"));
    return capExcerpt(
      added ? `Added: ${excerptWindow(added, 0, 640)}` : "The page content changed.",
    );
  }

  const before = previousText.split("\n");
  const after = currentText.split("\n");
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const beforeLines = before.slice(prefix, before.length - suffix);
  const afterLines = after.slice(prefix, after.length - suffix);
  const removedText = compactExcerptText(beforeLines);
  const addedText = compactExcerptText(afterLines);
  const changedCharacter = firstCharacterDifference(
    beforeLines[0] ?? "",
    afterLines[0] ?? "",
  );

  const removed = excerptWindow(removedText, changedCharacter);
  const added = excerptWindow(addedText, changedCharacter);
  const parts = [
    added ? `Added: ${added}` : "",
    removed ? `Removed: ${removed}` : "",
  ].filter(Boolean);

  return capExcerpt(parts.join("\n") || "The page content changed.");
}

export async function ensureAnnualTaxCpaReminder(
  now = new Date(),
): Promise<boolean> {
  const key = businessDateKey(now);
  const [year, month] = key.split("-");
  if (month !== "12") return false;

  const sourceKey = `tax-cpa-annual-review:${year}`;
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.user.findFirst({
      where: { role: "OWNER", archivedAt: null },
      select: { id: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!candidate) {
      throw new Error("An active Owner is required for the annual tax CPA reminder.");
    }
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${candidate.id} FOR SHARE`;
    const owner = await tx.user.findFirst({
      where: { id: candidate.id, role: "OWNER", archivedAt: null },
      select: { id: true },
    });
    if (!owner) {
      throw new Error("An active Owner is required for the annual tax CPA reminder.");
    }

    const created = await tx.staffTask.createMany({
      data: [
        {
          note: CPA_REMINDER_TEXT,
          dueDate: businessDayBounds(now).start,
          priority: "NORMAL",
          assigneeUserId: owner.id,
          createdByUserId: owner.id,
          sourceKey,
        },
      ],
      skipDuplicates: true,
    });
    if (created.count !== 1) return false;

    const task = await tx.staffTask.findUniqueOrThrow({
      where: { sourceKey },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        userId: null,
        action: "tax.cpa_annual_review_task_created",
        entityType: "StaffTask",
        entityId: task.id,
        newValue: { sourceKey, year },
      },
    });
    return true;
  });
}

async function recordFailure(
  watchId: string,
  now: Date,
  cause: unknown,
): Promise<void> {
  await prisma.officialSourceWatch.update({
    where: { id: watchId },
    data: {
      consecutiveFailures: { increment: 1 },
      lastError: sanitizeError(cause),
      lastCheckedAt: now,
    },
  });
}

async function sendChangedSourceMessage(input: {
  id: string;
  label: string;
  url: string;
  hash: string;
  excerpt: string;
}): Promise<void> {
  const settings = await getBusinessSettings();
  const notifyTo =
    process.env.BILLING_NOTIFICATION_EMAIL || settings.publicEmail;
  const title = `Colorado updated ${input.label} — here is what's new`;

  await deliverMessage({
    idempotencyKey: `tax-source-changed:${input.id}:${input.hash}`,
    channel: "EMAIL",
    purpose: "TRANSACTIONAL",
    templateKey: "tax-source-changed",
    customerFacing: false,
    recipient: { type: "Staff", address: notifyTo },
    subject: { type: "OfficialSourceWatch", id: input.id },
    render: () => ({
      subject: title,
      text: [
        title,
        "",
        input.excerpt,
        "",
        `Official source: ${input.url}`,
        "",
        "This alert only means the official page changed. Appliance Desk did not interpret it as a law, filing-rule, taxability, or tax-rate change.",
      ].join("\n"),
    }),
  });
}

export async function runOfficialSourceWatch(
  now = new Date(),
): Promise<OfficialSourceWatchRun> {
  if (businessDateKey(now).slice(5, 7) === "12") {
    await ensureAnnualTaxCpaReminder(now);
  }

  const totals: OfficialSourceWatchRun = {
    checked: 0,
    changed: 0,
    recovered: 0,
    failed: 0,
  };
  if (!isColoradoMonday(now)) return totals;

  const watches = await listActiveOfficialSourceWatches();
  for (const watch of watches) {
    totals.checked += 1;

    try {
      let result;
      try {
        result = await fetchOfficialSourcePage(watch.url);
      } catch (cause) {
        await recordFailure(watch.id, now, cause);
        totals.failed += 1;
        continue;
      }

      const recovered = watch.consecutiveFailures > 0;
      if (watch.lastHash === null) {
        await prisma.officialSourceWatch.update({
          where: { id: watch.id },
          data: {
            lastHash: result.hash,
            lastText: result.text,
            lastCheckedAt: now,
            lastError: null,
            consecutiveFailures: 0,
          },
        });
        if (recovered) totals.recovered += 1;
        continue;
      }

      if (watch.lastHash === result.hash) {
        await prisma.officialSourceWatch.update({
          where: { id: watch.id },
          data: {
            lastCheckedAt: now,
            lastError: null,
            consecutiveFailures: 0,
          },
        });
        if (recovered) totals.recovered += 1;

        if (
          watch.lastChangedAt &&
          !watch.reviewedAt &&
          watch.lastExcerpt
        ) {
          try {
            await sendChangedSourceMessage({
              id: watch.id,
              label: watch.label,
              url: watch.url,
              hash: result.hash,
              excerpt: watch.lastExcerpt,
            });
          } catch {
            console.error(
              "[tax-source-watch] Owner message ledger write failed",
              watch.id,
            );
          }
        }
        continue;
      }

      const excerpt = buildOfficialSourceChangeExcerpt(
        watch.lastText,
        result.text,
      );
      await prisma.officialSourceWatch.update({
        where: { id: watch.id },
        data: {
          lastHash: result.hash,
          lastText: result.text,
          lastExcerpt: excerpt,
          lastCheckedAt: now,
          lastChangedAt: now,
          lastError: null,
          consecutiveFailures: 0,
          reviewedAt: null,
        },
      });
      totals.changed += 1;
      if (recovered) totals.recovered += 1;

      try {
        await sendChangedSourceMessage({
          id: watch.id,
          label: watch.label,
          url: watch.url,
          hash: result.hash,
          excerpt,
        });
      } catch {
        console.error(
          "[tax-source-watch] Owner message ledger write failed",
          watch.id,
        );
      }
    } catch (cause) {
      totals.failed += 1;
      try {
        await recordFailure(watch.id, now, cause);
      } catch {
        // The row may have been deleted or disabled after the initial list read.
      }
      console.error("[tax-source-watch] Source processing failed", watch.id);
    }
  }

  return totals;
}

export async function acknowledgeOfficialSourceChange(
  watchId: string,
  expectedVersion: string,
  now = new Date(),
): Promise<boolean> {
  const session = await requireRole("OWNER");

  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, session.user.id, ["OWNER"]);
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        lastChangedAt: Date | null;
        reviewedAt: Date | null;
        active: boolean;
        lastHash: string | null;
      }>
    >`
      SELECT "id", "lastChangedAt", "reviewedAt", "active", "lastHash"
      FROM "OfficialSourceWatch"
      WHERE "id" = ${watchId}
      FOR UPDATE
    `;
    const current = rows[0];
    if (
      !current ||
      !current.active ||
      !current.lastChangedAt ||
      current.reviewedAt ||
      !expectedVersion ||
      `${current.lastHash}:${current.lastChangedAt.getTime()}` !== expectedVersion
    ) {
      return false;
    }

    await tx.officialSourceWatch.update({
      where: { id: watchId },
      data: { reviewedAt: now },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "tax.official_source_change_reviewed",
        entityType: "OfficialSourceWatch",
        entityId: watchId,
        oldValue: {
          reviewedAt: null,
          lastChangedAt: current.lastChangedAt.toISOString(),
          lastHash: current.lastHash,
        },
        newValue: { reviewedAt: now.toISOString(), lastHash: current.lastHash },
      },
    });
    return true;
  });
}
