import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { getPrivatePhotoStore } from "@/lib/photo-storage";
import { previewToken, verifyToken } from "@/lib/preview-token";
import { businessDateKey } from "@/lib/business-date";
import { listTaxabilityRuleCells } from "@/domains/tax/locations";
import { ruleAsOf } from "@/domains/rules/reads";
import {
  AUDIENCES,
  DECISION_SUBJECTS,
  decisionSubject,
  type Audience,
  type DecisionContext,
  type DecisionSourceRef,
  type DecisionSubject,
  type DecisionWriteKind,
} from "./registry";
import {
  CHANGED_SINCE_OPENED,
  cleanText,
  decisionAttachmentProblem,
  decisionStart,
  decisionState,
  matchOption,
  needsAppChange,
  previewFingerprint,
  sameValue,
  type DecisionKind,
  type DecisionState,
} from "./rules";
import { GREELEY_JURISDICTION_WHERE } from "./tax-cells";

/**
 * Decisions & reviews — reads and writes (DEC-1a, docs/build-specs/engines/DECISIONS-CENTER.md sections 3–4a).
 *
 * Reads: OWNER and ADMIN (checked in the query transaction; a missing or other role is refused). Writes: OWNER only,
 * one transaction each: the owner is re-checked, the settings row is locked so decisions happen one at a time, the
 * subject's own domain save runs (same locks, checks, audit and history as its own screen), then the append-only
 * DecisionRecord and an audit row are written. Nothing here ever updates or deletes a DecisionRecord.
 */
export type { Audience, DecisionState };
export type DecisionVia = "SCREEN" | "IMPORT" | "MCP" | "MIGRATION";

export type DecisionRecordDTO = {
  id: string;
  kind: DecisionKind;
  audience: Audience;
  value: Prisma.JsonValue | null;
  previousValue: Prisma.JsonValue | null;
  effectiveFrom: Date | null;
  answeredByName: string | null;
  professionalName: string | null;
  professionalFirm: string | null;
  professionalAnsweredOn: Date | null;
  explanation: string | null;
  hasAttachment: boolean;
  sources: DecisionSourceRef[];
  via: string;
  createdAt: Date;
};

export type DecisionCard = Pick<DecisionSubject,
  "id" | "legacyIds" | "area" | "title" | "question" | "facts" | "options" | "allowOther" | "recommended" | "affects"
  | "reviewGate"> & {
  /** Who the question is with now: the professional it was sent to, otherwise the subject's usual audience. */
  audience: Audience;
  defaultAudience: Audience;
  current: { value: Prisma.JsonValue; words: string };
  state: DecisionState;
  /** The newest answer was "Other": the app needs a code change to follow it. */
  needsAppChange: boolean;
  last: DecisionRecordDTO | null;
  history: DecisionRecordDTO[];
  /** A change waiting for its start date ("Starts {date}"). */
  pending: { value: Prisma.JsonValue; words: string; effectiveFrom: Date } | null;
};

const HISTORY_LIMIT = 50;
// ACCT-1: an accountant may read — but listDecisions/getDecision narrow them to CPA-audience questions.
const READ_ROLES = ["OWNER", "ADMIN", "ACCOUNTANT"] as const;
const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

/** Everything the registry reads, in one pass: settings row once, tax cells once, filing accounts once. */
export async function loadDecisionContext(tx: Prisma.TransactionClient): Promise<DecisionContext> {
  const [settings, cells, greeley, accounts, retentionYears] = await Promise.all([
    tx.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { shortTermLeaseElection: true, rdfHandling: true, retailDeliveryFeeDecision: true,
        badDebtTaxRecovery: true, setupFeeTaxPlanningTreatment: true, setupFeeTaxTreatment: true,
        trustedDeviceDays: true, lateFeeFlatCents: true },
    }),
    listTaxabilityRuleCells(tx),
    tx.taxJurisdiction.findFirst({ where: GREELEY_JURISDICTION_WHERE, select: { id: true }, orderBy: { id: "asc" } }),
    tx.taxFilingAccount.findMany({ select: { basis: true }, orderBy: { id: "asc" } }),
    // TFA-1: how long records are kept is a dated rule, not a setting.
    ruleAsOf<number>("records.keep_years", new Date(), tx).then((row) => row.value),
  ]);
  // DEC-2: Greeley's city rate as of today (only looked up once the Greeley area exists).
  const greeleyRate = greeley
    ? await tx.taxRateVersion.findFirst({
      where: { jurisdictionId: greeley.id, effectiveFrom: { lte: new Date() } },
      orderBy: { effectiveFrom: "desc" }, select: { rateMilliPercent: true },
    })
    : null;
  return {
    settings: {
      shortTermLeaseElection: settings?.shortTermLeaseElection ?? "UNDECIDED",
      rdfHandling: settings?.rdfHandling ?? "UNDECIDED",
      retailDeliveryFeeDecision: settings?.retailDeliveryFeeDecision ?? "UNDECIDED",
      badDebtTaxRecovery: settings?.badDebtTaxRecovery ?? "UNDECIDED",
      setupFeeTaxPlanningTreatment: settings?.setupFeeTaxPlanningTreatment ?? "TAXABLE",
      setupFeeTaxTreatment: settings?.setupFeeTaxTreatment ?? "UNDECIDED",
      recordRetentionYears: retentionYears,
      trustedDeviceDays: settings?.trustedDeviceDays ?? 30,
      lateFeeFlatCents: settings?.lateFeeFlatCents ?? 0,
    },
    taxCells: cells.map((cell) => ({ jurisdictionId: cell.jurisdictionId, category: cell.category,
      taxability: cell.taxability, provisional: cell.provisional })),
    greeleyJurisdictionId: greeley?.id ?? null,
    greeleyRateMilliPercent: greeleyRate?.rateMilliPercent ?? null,
    filingBases: accounts.map((account) => account.basis),
  };
}

type RecordRow = {
  id: string; subjectId: string; kind: string; audience: string; value: Prisma.JsonValue | null;
  previousValue: Prisma.JsonValue | null; effectiveFrom: Date | null; professionalName: string | null;
  professionalFirm: string | null; professionalAnsweredOn: Date | null; explanation: string | null;
  attachmentUrl: string | null; sources: Prisma.JsonValue | null; via: string; createdAt: Date;
  answeredBy: { name: string | null } | null;
};

function sourcesOf(value: Prisma.JsonValue | null): DecisionSourceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    return typeof row.title === "string" && typeof row.url === "string" && typeof row.checkedOn === "string"
      ? [{ title: row.title, url: row.url, checkedOn: row.checkedOn }] : [];
  });
}

function toDTO(row: RecordRow): DecisionRecordDTO {
  return {
    id: row.id,
    kind: row.kind as DecisionKind,
    audience: (AUDIENCES as string[]).includes(row.audience) ? row.audience as Audience : "OWNER",
    value: row.value,
    previousValue: row.previousValue,
    effectiveFrom: row.effectiveFrom,
    answeredByName: row.answeredBy?.name ?? null,
    professionalName: row.professionalName,
    professionalFirm: row.professionalFirm,
    professionalAnsweredOn: row.professionalAnsweredOn,
    explanation: row.explanation,
    // The private file link is never handed to the screen; DEC-1b serves it through an owner-only route.
    hasAttachment: Boolean(row.attachmentUrl),
    sources: sourcesOf(row.sources),
    via: row.via,
    createdAt: row.createdAt,
  };
}

const RECORD_SELECT = {
  id: true, subjectId: true, kind: true, audience: true, value: true, previousValue: true, effectiveFrom: true,
  professionalName: true, professionalFirm: true, professionalAnsweredOn: true, explanation: true,
  attachmentUrl: true, sources: true, via: true, createdAt: true, answeredBy: { select: { name: true } },
} as const;

async function buildCards(tx: Prisma.TransactionClient, subjects: DecisionSubject[]): Promise<DecisionCard[]> {
  const ids = subjects.map((subject) => subject.id);
  const [ctx, records, pending] = await Promise.all([
    loadDecisionContext(tx),
    tx.decisionRecord.findMany({
      where: { subjectId: { in: ids } },
      select: RECORD_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10_000,
    }),
    tx.decisionScheduledChange.findMany({
      where: { subjectId: { in: ids }, appliedAt: null, cancelledAt: null },
      select: { subjectId: true, value: true, effectiveFrom: true },
    }),
  ]);
  const bySubject = new Map<string, RecordRow[]>();
  for (const row of records as RecordRow[]) {
    const list = bySubject.get(row.subjectId) ?? [];
    if (list.length < HISTORY_LIMIT) list.push(row);
    bySubject.set(row.subjectId, list);
  }
  const pendingBySubject = new Map(pending.map((row) => [row.subjectId, row]));
  const cards: DecisionCard[] = [];
  for (const subject of subjects) {
    const value = await subject.read(ctx);
    const rows = bySubject.get(subject.id) ?? [];
    const state = decisionState(subject.recommended !== null, rows);
    const sentTo = state === "WITH_PROFESSIONAL" ? rows[0]!.audience : null;
    const waiting = pendingBySubject.get(subject.id);
    cards.push({
      id: subject.id, legacyIds: subject.legacyIds, area: subject.area, title: subject.title,
      question: subject.question, facts: subject.facts, options: subject.options, allowOther: subject.allowOther,
      recommended: subject.recommended, affects: subject.affects, reviewGate: subject.reviewGate,
      audience: sentTo && (AUDIENCES as string[]).includes(sentTo) ? sentTo as Audience : subject.audience,
      defaultAudience: subject.audience,
      current: { value, words: subject.describe(value) },
      state,
      needsAppChange: needsAppChange(rows),
      last: rows[0] ? toDTO(rows[0]) : null,
      history: rows.map(toDTO),
      pending: waiting
        ? { value: waiting.value, words: subject.describe(waiting.value), effectiveFrom: waiting.effectiveFrom }
        : null,
    });
  }
  return cards;
}

export async function listDecisions(
  actorId: string,
  filter: { audience?: Audience; state?: DecisionState; area?: string } = {},
): Promise<DecisionCard[]> {
  return prisma.$transaction(async (tx) => {
    const actor = await assertActiveTeamActor(tx, actorId, READ_ROLES);
    const subjects = filter.area ? DECISION_SUBJECTS.filter((subject) => subject.area === filter.area) : DECISION_SUBJECTS;
    const cards = await buildCards(tx, subjects);
    return cards.filter((card) =>
      // ACCT-1: an accountant only ever sees questions addressed to a CPA.
      (actor.role !== "ACCOUNTANT" || card.audience === "CPA") &&
      (!filter.audience || card.audience === filter.audience) && (!filter.state || card.state === filter.state));
  }, TX_OPTIONS);
}

export async function getDecision(actorId: string, id: string): Promise<DecisionCard> {
  const subject = requireSubject(id);
  return prisma.$transaction(async (tx) => {
    const actor = await assertActiveTeamActor(tx, actorId, READ_ROLES);
    const card = (await buildCards(tx, [subject]))[0]!;
    if (actor.role === "ACCOUNTANT" && card.audience !== "CPA") {
      throw new Error("That question isn't addressed to a CPA.");
    }
    return card;
  }, TX_OPTIONS);
}

function requireSubject(id: string): DecisionSubject {
  const subject = decisionSubject(id.replace(/^DQ-/, ""));
  if (!subject) throw new Error("That question isn't in Decisions & reviews.");
  return subject;
}

/** Start of every write: owner only, then the settings row locked so decisions happen one at a time. */
async function beginWrite(tx: Prisma.TransactionClient, actorId: string) {
  await assertActiveTeamActor(tx, actorId, ["OWNER"]);
  await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
}

/** A newer decision on the same subject cancels a change still waiting for its start date (same transaction). */
async function cancelPending(tx: Prisma.TransactionClient, subjectId: string, now: Date) {
  await tx.decisionScheduledChange.updateMany({
    where: { subjectId, appliedAt: null, cancelledAt: null },
    data: { cancelledAt: now },
  });
}

/** DEC-2: the owner acting on a question counts as having looked at the starting values (clears the To do item). */
async function markReviewedInTx(tx: Prisma.TransactionClient, now: Date) {
  await tx.businessSettings.updateMany({ where: { id: "singleton" }, data: { decisionsReviewedAt: now } });
}

async function insertRecord(
  tx: Prisma.TransactionClient,
  actorId: string,
  data: {
    subjectId: string; kind: DecisionKind; audience: Audience; value: Prisma.JsonValue | null;
    previousValue: Prisma.JsonValue | null; effectiveFrom: Date | null; via: DecisionVia;
    professionalName?: string | null; professionalFirm?: string | null; professionalAnsweredOn?: Date | null;
    explanation?: string | null; attachmentUrl?: string | null; sources?: DecisionSourceRef[] | null;
    /** DEC-2: the app's own nightly run records the answer; no person answered, so nobody is named. */
    noAnswerer?: boolean;
    agentOperationId?: string;
  },
) {
  const json = (value: Prisma.JsonValue | null | undefined) =>
    value === null || value === undefined ? Prisma.DbNull : value as Prisma.InputJsonValue;
  const record = await tx.decisionRecord.create({
    data: {
      subjectId: data.subjectId, kind: data.kind, audience: data.audience,
      value: json(data.value), previousValue: json(data.previousValue),
      effectiveFrom: data.effectiveFrom, answeredByUserId: data.noAnswerer ? null : actorId,
      professionalName: data.professionalName ?? null, professionalFirm: data.professionalFirm ?? null,
      professionalAnsweredOn: data.professionalAnsweredOn ?? null, explanation: data.explanation ?? null,
      attachmentUrl: data.attachmentUrl ?? null,
      sources: data.sources?.length ? data.sources : Prisma.DbNull, via: data.via,
      agentOperationId: data.agentOperationId ?? null,
    },
    select: { id: true },
  });
  await tx.auditLog.create({
    data: {
      userId: actorId, action: `decision.${data.kind.toLowerCase()}`,
      entityType: "DecisionRecord", entityId: record.id,
      newValue: { subjectId: data.subjectId, kind: data.kind, audience: data.audience, via: data.via,
        effectiveFrom: data.effectiveFrom?.toISOString() ?? null },
    },
  });
  return record.id;
}


type ApplyInput = {
  subject: DecisionSubject;
  kind: Exclude<DecisionWriteKind, "CONFIRMED"> | "CONFIRMED";
  value: Prisma.JsonValue;
  previous: Prisma.JsonValue;
  effectiveFrom: string | Date | null | undefined;
  confirmedOn: Date;
  reason: string;
  sources: DecisionSourceRef[];
  record: Omit<Parameters<typeof insertRecord>[2], "subjectId" | "kind" | "value" | "previousValue" | "effectiveFrom">;
  now: Date;
  /** The context `previous` was read from (decides whether saving the same value again changes anything). */
  ctx: DecisionContext;
  /** ACCT-1: see DecisionWriteMeta.professionalAnswer — set only by the accountant branch below. */
  professionalAnswer?: boolean;
};

/** Record the decision, then save it now or keep it for its start date. Returns the record id. */
async function applyDecisionInTx(tx: Prisma.TransactionClient, actorId: string, input: ApplyInput) {
  const start = decisionStart(input.effectiveFrom, input.now);
  await cancelPending(tx, input.subject.id, input.now);
  const recordId = await insertRecord(tx, actorId, {
    ...input.record, subjectId: input.subject.id, kind: input.kind, value: input.value,
    previousValue: input.previous, effectiveFrom: start.later ? start.start : null,
  });
  if (start.later) {
    await tx.decisionScheduledChange.create({
      data: { subjectId: input.subject.id, value: input.value as Prisma.InputJsonValue, effectiveFrom: start.start,
        decisionRecordId: recordId, provisional: input.kind === "STARTING_VALUE_APPLIED" },
    });
    return recordId;
  }
  const changes = !sameValue(input.value, input.previous);
  if (changes || input.subject.confirmWrite?.(input.ctx, input.kind)) {
    await input.subject.write(tx, actorId, input.value, null, {
      kind: input.kind, confirmedOn: input.confirmedOn, reason: input.reason, sources: input.sources,
      effectiveFrom: start.start, previousValue: input.previous,
      professionalAnswer: input.professionalAnswer === true,
    });
  }
  return recordId;
}

function checkOption(subject: DecisionSubject, value: Prisma.JsonValue) {
  const option = matchOption(subject, value);
  if (!option) throw new Error("That answer isn't one of the choices for this question.");
  const problem = subject.validate(option.value);
  if (problem) throw new Error(problem);
  return option.value;
}

async function runWrite<T>(actorId: string, subjects: DecisionSubject[], work: (tx: Prisma.TransactionClient) => Promise<T>) {
  const result = await prisma.$transaction(async (tx) => {
    await beginWrite(tx, actorId);
    return work(tx);
  }, TX_OPTIONS);
  for (const subject of new Set(subjects)) await subject.afterCommit?.();
  return result;
}

/** "Keep this": the owner confirms the value the app uses now. Refused if it changed since the screen was opened. */
export async function confirmDecision(actorId: string, id: string, expectedValue: Prisma.JsonValue): Promise<void> {
  const subject = requireSubject(id);
  const now = new Date();
  await runWrite(actorId, [], async (tx) => {
    const ctx = await loadDecisionContext(tx);
    const current = await subject.read(ctx);
    if (!sameValue(current, expectedValue)) throw new Error(CHANGED_SINCE_OPENED);
    if (!matchOption(subject, current)) throw new Error("Nothing is set yet to keep. Choose an answer with Change… instead.");
    await applyDecisionInTx(tx, actorId, {
      subject, kind: "CONFIRMED", value: current, previous: current, effectiveFrom: null, confirmedOn: now,
      reason: "Confirmed by the owner in Decisions & reviews", sources: [],
      record: { audience: "OWNER", via: "SCREEN" }, now, ctx,
    });
    await markReviewedInTx(tx, now);
  });
}

export async function changeDecision(
  actorId: string, id: string, value: Prisma.JsonValue, effectiveFrom: string | Date | null, note?: string | null,
  via: DecisionVia = "SCREEN",
): Promise<void> {
  const subject = requireSubject(id);
  const chosen = checkOption(subject, value);
  const explanation = cleanText(note, 4000, "note");
  const now = new Date();
  decisionStart(effectiveFrom, now);
  await runWrite(actorId, [subject], async (tx) => {
    const ctx = await loadDecisionContext(tx);
    const previous = await subject.read(ctx);
    await applyDecisionInTx(tx, actorId, {
      subject, kind: "CHANGED", value: chosen, previous, effectiveFrom, confirmedOn: now,
      reason: ("Changed by the owner in Decisions & reviews" + (explanation ? ": " + explanation : "")).slice(0, 500),
      sources: [], record: { audience: "OWNER", via, explanation }, now, ctx,
    });
    await markReviewedInTx(tx, now);
  });
}

export async function sendToProfessional(actorId: string, id: string, audience: Audience): Promise<void> {
  const subject = requireSubject(id);
  if (audience !== "CPA" && audience !== "ATTORNEY" && audience !== "TRANSLATOR")
    throw new Error("Choose your CPA, attorney or translator.");
  await runWrite(actorId, [], async (tx) => {
    await insertRecord(tx, actorId, {
      subjectId: subject.id, kind: "SENT_TO_PROFESSIONAL", audience, value: null, previousValue: null,
      effectiveFrom: null, via: "SCREEN",
    });
  });
}

/** "Reopen": the question goes back to "Starting value"; the value the app uses stays as it is. */
export async function reopenDecision(actorId: string, id: string): Promise<void> {
  const subject = requireSubject(id);
  await runWrite(actorId, [], async (tx) => {
    await insertRecord(tx, actorId, {
      subjectId: subject.id, kind: "REOPENED", audience: subject.audience, value: null, previousValue: null,
      effectiveFrom: null, via: "SCREEN",
    });
  });
}

export type ProfessionalAnswerInput = {
  /** One of the subject's choices, or null for "Other" (then `otherText` says what they answered). */
  value: Prisma.JsonValue | null;
  otherText?: string | null;
  effectiveFrom: string | Date | null;
  professionalName: string;
  professionalFirm?: string | null;
  answeredOn: string | Date;
  explanation?: string | null;
  attachmentUrl?: string | null;
};

function answeredOnDate(value: string | Date, now: Date): Date {
  const date = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + "T12:00:00Z" : value);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 2000) throw new Error("Enter the date they answered.");
  if (date.getTime() > now.getTime() + 24 * 60 * 60 * 1000) throw new Error("The answer date can't be in the future.");
  return date;
}

function checkAttachment(url: string | null | undefined, subjectId: string | string[]): string | null {
  const clean = cleanText(url, 1000, "attachment link");
  if (!clean) return null;
  const problem = decisionAttachmentProblem(clean, getPrivatePhotoStore()?.storeId ?? null, subjectId);
  if (problem) throw new Error(problem);
  return clean;
}

async function professionalAudience(tx: Prisma.TransactionClient, subject: DecisionSubject): Promise<Audience> {
  const last = await tx.decisionRecord.findFirst({
    where: { subjectId: subject.id }, select: { kind: true, audience: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return last?.kind === "SENT_TO_PROFESSIONAL" && (AUDIENCES as string[]).includes(last.audience)
    ? last.audience as Audience : subject.audience;
}

async function recordProfessionalAnswerInTx(
  tx: Prisma.TransactionClient, actorId: string, subject: DecisionSubject, input: ProfessionalAnswerInput,
  via: DecisionVia, now: Date, attachmentUrl: string | null, professionalAnswer = false,
  agentOperationId?: string,
) {
  const professionalName = cleanText(input.professionalName, 120, "name of who answered");
  if (!professionalName) throw new Error("Enter who answered.");
  const professionalFirm = cleanText(input.professionalFirm, 120, "firm");
  const explanation = cleanText(input.explanation, 4000, "explanation");
  const answeredOn = answeredOnDate(input.answeredOn, now);
  const audience = await professionalAudience(tx, subject);
  const ctx = await loadDecisionContext(tx);
  const previous = await subject.read(ctx);
  const professional = { audience, via, professionalName, professionalFirm, professionalAnsweredOn: answeredOn,
    attachmentUrl };
  if (input.value === null) {
    // "Other" is never applied to a setting: it is kept as evidence and becomes a change to the app.
    const otherText = cleanText(input.otherText, 1000, "other answer");
    if (!subject.allowOther) throw new Error("This question only accepts one of its choices.");
    if (!otherText) throw new Error("Write what they answered.");
    await insertRecord(tx, actorId, {
      ...professional, agentOperationId, subjectId: subject.id, kind: "PROFESSIONAL_ANSWER", value: null, previousValue: previous,
      effectiveFrom: null, explanation: ["Other: " + otherText, explanation].filter(Boolean).join("\n\n").slice(0, 4000),
    });
    return;
  }
  const chosen = checkOption(subject, input.value);
  const who = professionalFirm ? `${professionalName}, ${professionalFirm}` : professionalName;
  await applyDecisionInTx(tx, actorId, {
    subject, kind: "PROFESSIONAL_ANSWER", value: chosen, previous, effectiveFrom: input.effectiveFrom,
    confirmedOn: answeredOn, reason: `Answered by ${who}${explanation ? ": " + explanation : ""}`.slice(0, 500),
    sources: [], record: { ...professional, explanation, agentOperationId }, now, ctx, professionalAnswer,
  });
}

export async function recordProfessionalAnswer(
  actorId: string, id: string, input: ProfessionalAnswerInput, via: "SCREEN" | "IMPORT" | "MCP",
): Promise<void> {
  const subject = requireSubject(id);
  const now = new Date();
  if (input.value !== null) checkOption(subject, input.value);
  decisionStart(input.effectiveFrom, now);
  const attachmentUrl = checkAttachment(input.attachmentUrl, subject.id);
  // ACCT-1: an accountant may answer — but only a question addressed to a CPA, and the name/firm on the
  // record are the accountant's own from their account, never whatever the request claims. Every other
  // decisions write stays owner-only (beginWrite inside runWrite is unchanged).
  // The branch is decided inside the one transaction, from the actor row the
  // transaction itself reads — the same shape every decisions write uses.
  await prisma.$transaction(async (tx) => {
    const me = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, name: true, firm: true } });
    if (me?.role === "ACCOUNTANT") {
      if (via !== "SCREEN") throw new Error("That question isn't addressed to a CPA.");
      await assertActiveTeamActor(tx, actorId, ["ACCOUNTANT"]);
      await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
      if ((await professionalAudience(tx, subject)) !== "CPA") {
        throw new Error("That question isn't addressed to a CPA.");
      }
      const mine: ProfessionalAnswerInput = {
        ...input,
        professionalName: me?.name?.trim() ? me.name : input.professionalName,
        professionalFirm: me?.firm?.trim() ? me.firm : input.professionalFirm,
      };
      if (input.value !== null && input.effectiveFrom && new Date(input.effectiveFrom).getTime() > now.getTime()) {
        throw new Error("An accountant's answer takes effect right away. For an answer that starts later, the owner records it instead.");
      }
      await recordProfessionalAnswerInTx(tx, actorId, subject, mine, via, now, attachmentUrl, true);
      return;
    }
    await beginWrite(tx, actorId);
    await recordProfessionalAnswerInTx(tx, actorId, subject, input, via, now, attachmentUrl);
  }, TX_OPTIONS);
  if (input.value !== null) await subject.afterCommit?.();
}

/**
 * DEC-2's path for a researched starting value: saved through the subject's own save (a tax cell is saved as
 * provisional, "Starting value — not confirmed"), with its sources kept on the record.
 */
export async function applyStartingValue(
  actorId: string, id: string,
  input: {
    value: Prisma.JsonValue; effectiveFrom: string | Date | null; why: string; sources: DecisionSourceRef[];
    /** CONFIRMED for a question the owner already answered (DEC-2); the default is a starting value. */
    kind?: "STARTING_VALUE_APPLIED" | "CONFIRMED";
    /**
     * DEC-2's nightly run: re-check, under the same lock the write takes, that nobody has answered this question since
     * the run looked (any record) and that the setting is still untouched; if not, nothing is saved.
     */
    onlyIfStillUntouched?: boolean;
  },
  via: DecisionVia = "SCREEN",
): Promise<"APPLIED" | "ALREADY_ANSWERED" | "ALREADY_CHANGED"> {
  const subject = requireSubject(id);
  const chosen = checkOption(subject, input.value);
  const why = cleanText(input.why, 500, "reason");
  if (!why) throw new Error("Explain why this starting value was chosen.");
  if (!Array.isArray(input.sources) || input.sources.length > 20) throw new Error("Invalid source list.");
  const now = new Date();
  decisionStart(input.effectiveFrom, now);
  return runWrite(actorId, [subject], async (tx): Promise<"APPLIED" | "ALREADY_ANSWERED" | "ALREADY_CHANGED"> => {
    const ctx = await loadDecisionContext(tx);
    const previous = await subject.read(ctx);
    if (input.onlyIfStillUntouched) {
      if (await tx.decisionRecord.findFirst({ where: { subjectId: subject.id }, select: { id: true } })) return "ALREADY_ANSWERED";
      const recommended = subject.recommended?.value;
      const untouched = previous === "UNDECIDED" || (recommended !== undefined && sameValue(previous, recommended)) ||
        (subject.untouchedDefault !== undefined && sameValue(previous, subject.untouchedDefault));
      if (previous === null || !untouched) return "ALREADY_CHANGED";
    }
    await applyDecisionInTx(tx, actorId, {
      subject, kind: input.kind ?? "STARTING_VALUE_APPLIED", value: chosen, previous, effectiveFrom: input.effectiveFrom,
      confirmedOn: now, reason: why, sources: input.sources,
      record: { audience: subject.audience, via, explanation: why, sources: input.sources,
        ...(via === "MIGRATION" ? { noAnswerer: true } : {}) }, now, ctx,
    });
    return "APPLIED";
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Completed questionnaires: preview exactly what would change, then apply exactly that (spec section 4).

/** One answer read from a completed form (the parser and the MCP tool produce these). */
export type ParsedAnswer = {
  /** The question's code, with or without the "DQ-" prefix. */
  code: string;
  /** The ticked choice (its value or its label), or null when "Other" was written. */
  option: Prisma.JsonValue | null;
  otherText?: string | null;
  effectiveFrom?: string | null;
  explanation?: string | null;
  answeredBy?: string | null;
  firm?: string | null;
  answeredOn?: string | null;
  /** Set by the form reader when the answer can't be read safely (e.g. "Two answers were ticked"): shown as INVALID. */
  problem?: string | null;
};

export type AnswerPreview = {
  code: string;
  title: string;
  now: string;
  after: string;
  effectiveFrom: string | null;
  /** OTHER: recorded as evidence only; the app needs a change to follow it. */
  status: "CHANGE" | "SAME" | "OTHER" | "INVALID";
  reason?: string;
};

type TokenClaims = { v: 1; uid: string; sha: string; exp: number };
const TOKEN_ERRORS = { label: "Answers preview", error: (message: string) => new Error(message) };
const PREVIEW_MINUTES = 30;

async function previewInTx(tx: Prisma.TransactionClient, answers: ParsedAnswer[], now: Date): Promise<AnswerPreview[]> {
  if (!Array.isArray(answers) || answers.length === 0) throw new Error("No answers were found to preview.");
  if (answers.length > 200) throw new Error("Preview at most 200 answers at a time.");
  const ctx = await loadDecisionContext(tx);
  const seen = new Map<string, number>();
  for (const answer of answers) {
    const code = String(answer.code ?? "").trim().replace(/^\[?DQ-/, "").replace(/\]$/, "");
    seen.set(code, (seen.get(code) ?? 0) + 1);
  }
  const out: AnswerPreview[] = [];
  for (const answer of answers) {
    const code = String(answer.code ?? "").trim().replace(/^\[?DQ-/, "").replace(/\]$/, "");
    const subject = decisionSubject(code);
    const effective = answer.effectiveFrom?.trim() || null;
    const base = { code, title: subject?.title ?? "Unknown question", effectiveFrom: effective };
    if (!subject) { out.push({ ...base, now: "", after: "", status: "INVALID", reason: "This code isn't a question in the app." }); continue; }
    const current = await subject.read(ctx);
    const now_ = subject.describe(current);
    const invalid = (reason: string) => out.push({ ...base, now: now_, after: "", status: "INVALID", reason });
    if ((seen.get(code) ?? 0) > 1) { invalid("This question was answered more than once."); continue; }
    if (typeof answer.problem === "string" && answer.problem.trim()) { invalid(answer.problem.trim().slice(0, 300)); continue; }
    if (!cleanText(answer.answeredBy ?? null, 120, "name of who answered")) { invalid("Fill in who answered."); continue; }
    try {
      decisionStart(effective, now);
      if (answer.answeredOn) answeredOnDate(answer.answeredOn, now);
    } catch (error) {
      invalid(error instanceof Error ? error.message : "Check the dates."); continue;
    }
    if (answer.option === null || answer.option === undefined) {
      if (!subject.allowOther) { invalid("This question only accepts one of its choices."); continue; }
      const other = cleanText(answer.otherText ?? null, 1000, "other answer");
      if (!other) { invalid("No answer was ticked or written."); continue; }
      out.push({ ...base, now: now_, after: `Needs a change to the app: ${other}`, status: "OTHER" });
      continue;
    }
    const option = matchOption(subject, answer.option);
    if (!option || subject.validate(option.value)) {
      invalid(subject.allowOther ? "That answer isn't one of the choices; write it under Other." : "That answer isn't one of the choices.");
      continue;
    }
    out.push({ ...base, now: now_, after: subject.describe(option.value),
      status: sameValue(option.value, current) ? "SAME" : "CHANGE" });
  }
  return out;
}

/** The completed form attached to every answer: a private file kept with one of the previewed questions. */
function formAttachment(url: string | null | undefined, preview: AnswerPreview[]): string | null {
  const subjects = preview.filter((row) => row.status !== "INVALID").map((row) => row.code);
  return checkAttachment(url, subjects.length ? subjects : ["-"]);
}

/** What the confirm token binds: the answers, what the app showed for them, and the attached form. */
function answersFingerprint(answers: ParsedAnswer[], preview: AnswerPreview[], attachmentUrl: string | null) {
  return previewFingerprint({ answers, preview, attachmentUrl });
}

export async function previewAnswers(
  actorId: string, answers: ParsedAnswer[], opts: { attachmentUrl?: string | null } = {},
): Promise<{ preview: AnswerPreview[]; confirmToken: string }> {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    const preview = await previewInTx(tx, answers, now);
    const attachmentUrl = formAttachment(opts.attachmentUrl, preview);
    const claim: TokenClaims = { v: 1, uid: actorId, sha: answersFingerprint(answers, preview, attachmentUrl),
      exp: now.getTime() + PREVIEW_MINUTES * 60_000 };
    return { preview, confirmToken: previewToken(claim, TOKEN_ERRORS) };
  }, TX_OPTIONS);
}

function readClaims(token: string, actorId: string): TokenClaims {
  const claim = verifyToken(token, TOKEN_ERRORS) as Partial<TokenClaims> | null;
  if (!claim || claim.v !== 1 || claim.uid !== actorId || typeof claim.sha !== "string" ||
      !/^[a-f0-9]{64}$/.test(claim.sha) || !Number.isSafeInteger(claim.exp) || claim.exp! < Date.now() ||
      claim.exp! > Date.now() + (PREVIEW_MINUTES + 1) * 60_000)
    throw new Error("This preview has expired or isn't yours. Preview the answers again.");
  return claim as TokenClaims;
}

export type ApplyResult = { applied: number; same: number; other: number; skipped: number; preview: AnswerPreview[] };

/**
 * Applies exactly what was previewed: the preview is recomputed inside the same transaction and must match the
 * token, so a setting changed since (or different answers) refuses the whole apply. Each CHANGE/SAME becomes a
 * PROFESSIONAL_ANSWER (SAME confirms without saving the setting); each OTHER is kept as evidence only.
 */
export async function applyAnswers(
  actorId: string, answers: ParsedAnswer[], confirmToken: string,
  opts: { via?: "IMPORT" | "MCP" | "SCREEN"; attachmentUrl?: string | null;
    agentOperationId?: string } = {},
): Promise<ApplyResult> {
  const claim = readClaims(confirmToken, actorId);
  const now = new Date();
  const touched: DecisionSubject[] = [];
  // One apply per preview: the token's fingerprint is recorded when it is used (the settings lock serializes this).
  const used = createHash("sha256").update(confirmToken).digest("hex");
  const result = await runWrite(actorId, touched, async (tx) => {
    if (await tx.auditLog.findFirst({
      where: { action: "decision.answers_applied", entityType: "DecisionAnswersPreview", entityId: used },
      select: { id: true },
    })) throw new Error("These answers were already applied. Preview the form again to apply it again.");
    const preview = await previewInTx(tx, answers, now);
    const attachmentUrl = formAttachment(opts.attachmentUrl, preview);
    if (answersFingerprint(answers, preview, attachmentUrl) !== claim.sha)
      throw new Error("The answers or the app's settings changed since the preview. Preview again before applying.");
    const counts: ApplyResult = { applied: 0, same: 0, other: 0, skipped: 0, preview };
    for (const [index, row] of preview.entries()) {
      const answer = answers[index]!;
      if (row.status === "INVALID") { counts.skipped += 1; continue; }
      const subject = requireSubject(row.code);
      await recordProfessionalAnswerInTx(tx, actorId, subject, {
        value: row.status === "OTHER" ? null : matchOption(subject, answer.option)!.value,
        otherText: answer.otherText ?? null,
        effectiveFrom: answer.effectiveFrom ?? null,
        professionalName: answer.answeredBy ?? "",
        professionalFirm: answer.firm ?? null,
        answeredOn: answer.answeredOn ?? now,
        explanation: answer.explanation ?? null,
      }, opts.via ?? "IMPORT", now, attachmentUrl, false,
      opts.via === "MCP" ? opts.agentOperationId : undefined);
      if (row.status === "CHANGE") { counts.applied += 1; touched.push(subject); }
      else if (row.status === "SAME") counts.same += 1;
      else counts.other += 1;
    }
    await tx.auditLog.create({
      data: { userId: actorId, action: "decision.answers_applied", entityType: "DecisionAnswersPreview",
        entityId: used, newValue: { applied: counts.applied, same: counts.same, other: counts.other,
          skipped: counts.skipped, via: opts.via ?? "IMPORT" } },
    });
    return counts;
  });
  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// The nightly run: apply every change whose start date has come (spec section 4a).

/**
 * A waiting change whose decider no longer has owner access is not applied (that would act for someone who can't
 * act any more). It is cancelled with an audit row, and the current owner gets a To do to decide it again, so the
 * nightly run doesn't fail on it every night.
 */
async function cancelForInactiveDecider(
  tx: Prisma.TransactionClient, change: { id: string; subjectId: string; effectiveFrom: Date }, now: Date,
) {
  await tx.decisionScheduledChange.update({ where: { id: change.id }, data: { cancelledAt: now } });
  await tx.auditLog.create({
    data: { userId: null, action: "decision.scheduled_cancelled", entityType: "DecisionScheduledChange",
      entityId: change.id, newValue: { subjectId: change.subjectId, effectiveFrom: change.effectiveFrom.toISOString(),
        reason: "The person who decided it no longer has owner access." } },
  });
  const owner = await tx.user.findFirst({
    where: { role: "OWNER", archivedAt: null }, select: { id: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!owner) return;
  const title = decisionSubject(change.subjectId)?.title ?? change.subjectId;
  const { createTaskInTx } = await import("@/domains/tasks");
  await createTaskInTx(tx, { userId: owner.id, role: "OWNER" }, {
    note: `Decide again: "${title}". A change set to start ${businessDateKey(change.effectiveFrom)} was cancelled ` +
      "because the person who made it no longer has owner access. Nothing was changed.",
    priority: "NORMAL", assigneeUserId: owner.id, dueDate: businessDateKey(now),
    sourceKey: `decision-cancelled:${change.id}`,
  });
}

/**
 * Applies each due, not-cancelled scheduled change once, through the subject's own save with the same locks and
 * audit, as the owner who decided it (re-checked: a deactivated owner's change is cancelled instead, see above).
 * Safe to repeat: the row is locked and `appliedAt` re-checked inside the same transaction, and the change is marked
 * applied before the save runs so the save's own "cancel waiting changes" step never cancels it.
 */
export async function applyDueDecisionChanges(
  now: Date = new Date(),
): Promise<{ applied: number; failed: number; cancelled: number }> {
  const due = await prisma.decisionScheduledChange.findMany({
    where: { appliedAt: null, cancelledAt: null, effectiveFrom: { lte: now } },
    select: { id: true }, orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }], take: 500,
  });
  let applied = 0;
  let failed = 0;
  let cancelled = 0;
  for (const { id } of due) {
    try {
      const subject = await prisma.$transaction(async (tx) => {
        // Same lock order as every decision write (settings row first, then the waiting change), so the nightly run
        // and an owner's change at the same moment wait for each other instead of deadlocking.
        await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
        const rows = await tx.$queryRaw<Array<{ appliedAt: Date | null; cancelledAt: Date | null }>>`
          SELECT "appliedAt", "cancelledAt" FROM "DecisionScheduledChange" WHERE "id" = ${id} FOR UPDATE`;
        if (!rows[0] || rows[0].appliedAt || rows[0].cancelledAt) return null;
        const change = await tx.decisionScheduledChange.findUniqueOrThrow({ where: { id } });
        const record = await tx.decisionRecord.findUniqueOrThrow({
          where: { id: change.decisionRecordId },
          select: { kind: true, via: true, answeredByUserId: true, professionalName: true, professionalFirm: true,
            professionalAnsweredOn: true, explanation: true, sources: true, createdAt: true },
        });
        const subject = decisionSubject(change.subjectId);
        if (!subject) throw new Error("The question behind this change is no longer in the app.");
        if (record.answeredByUserId) {
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${record.answeredByUserId} FOR SHARE`;
        }
        // DEC-2: a value the app's own nightly run recorded names nobody as its answerer. It is saved by the one
        // active owner (the same rule the nightly run used to schedule it); with none or several it stays waiting
        // untouched, and is never cancelled as if a person had left.
        const systemMade = !record.answeredByUserId && record.via === "MIGRATION";
        let executorId = record.answeredByUserId;
        if (systemMade) {
          const owners = await tx.user.findMany({
            where: { role: "OWNER", archivedAt: null }, select: { id: true }, take: 2, orderBy: { id: "asc" },
          });
          if (owners.length !== 1) return null;
          executorId = owners[0]!.id;
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${executorId} FOR SHARE`;
        }
        const decider = executorId ? await tx.user.findUnique({
          where: { id: executorId }, select: { role: true, archivedAt: true },
        }) : null;
        if (!decider || decider.archivedAt || decider.role !== "OWNER") {
          await cancelForInactiveDecider(tx, change, now);
          return "CANCELLED" as const;
        }
        const actorId = executorId!;
        await assertActiveTeamActor(tx, actorId, ["OWNER"]);
        await tx.decisionScheduledChange.update({ where: { id }, data: { appliedAt: now } });
        const previous = await subject.read(await loadDecisionContext(tx));
        const who = record.professionalName
          ? (record.professionalFirm ? `${record.professionalName}, ${record.professionalFirm}` : record.professionalName)
          : "the owner";
        const kind = ((systemMade ? ["CHANGED", "PROFESSIONAL_ANSWER", "STARTING_VALUE_APPLIED", "CONFIRMED"]
          : ["CHANGED", "PROFESSIONAL_ANSWER", "STARTING_VALUE_APPLIED"]).includes(record.kind)
          ? record.kind : "CHANGED") as DecisionWriteKind;
        await subject.write(tx, actorId, change.value, change.effectiveFrom, {
          kind,
          confirmedOn: record.professionalAnsweredOn ?? record.createdAt,
          reason: (kind === "STARTING_VALUE_APPLIED" || (systemMade && kind === "CONFIRMED")
            ? record.explanation ?? "Researched starting value"
            : `Decided by ${who}${record.explanation ? ": " + record.explanation : ""}`).slice(0, 500),
          sources: sourcesOf(record.sources),
          effectiveFrom: change.effectiveFrom,
          previousValue: previous,
        });
        await tx.auditLog.create({
          data: { userId: actorId, action: "decision.scheduled_applied",
            entityType: "DecisionScheduledChange", entityId: id,
            newValue: { subjectId: change.subjectId, effectiveFrom: change.effectiveFrom.toISOString() } },
        });
        return subject;
      }, TX_OPTIONS);
      if (subject === "CANCELLED") cancelled += 1;
      else if (subject) {
        applied += 1;
        await subject.afterCommit?.();
      }
    } catch (error) {
      failed += 1;
      console.error("[decisions] scheduled change could not be applied", id,
        error instanceof Error ? error.message.slice(0, 200) : "unknown");
    }
  }
  return { applied, failed, cancelled };
}
