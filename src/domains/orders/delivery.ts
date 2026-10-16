import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const DENVER = "America/Denver";
export const slotSchema = z.object({
  id: z.string().uuid(),
  date: z.iso.date(),
  window: z.enum(["AM", "PM"]),
}).strict();
export type DeliverySlot = z.infer<typeof slotSchema>;
export const questionsSchema = z.object({
  dryerOutlet: z.enum(["THREE_PRONG", "FOUR_PRONG", "GAS", "UNKNOWN"]),
  stairs: z.boolean(),
  washerHookups: z.enum(["YES", "NO", "UNKNOWN"]),
  crewNotes: z.string().trim().max(1500),
}).strict();
export const deliverySelectionSchema = z.object({
  optionId: z.string().uuid(),
  expectedOfferVersion: z.number().int().min(1),
  questions: questionsSchema,
}).strict();
export type DeliverySelection = z.infer<typeof deliverySelectionSchema>;
const optionsSchema = z.array(slotSchema).min(1).max(4);
export function readOfferedSlots(raw: unknown): DeliverySlot[] {
  const parsed = optionsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}
export function todayDenver(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DENVER, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now).replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$1-$2");
}
export function assertAvailableDeliveryOption(
  rawOptions: unknown, currentVersion: number, selection: DeliverySelection,
  now = new Date(),
) {
  const candidate = deliverySelectionSchema.parse(selection);
  const slots = readOfferedSlots(rawOptions);
  const slot = slots.find(option => option.id === candidate.optionId);
  if (!slot || currentVersion !== candidate.expectedOfferVersion)
    throw new Error("Delivery option has changed. Refresh the estimate.");
  if (slot.date < todayDenver(now))
    throw new Error("That delivery choice is now in the past. Ask for another.");
  return { slot, questions: candidate.questions, offeredVersion: currentVersion };
}
export function mileageBand(miles: number): {
  allowed: boolean; amountCents: number | null; band: string;
} {
  if (!Number.isFinite(miles) || miles < 0) throw new Error("Invalid verified driving distance.");
  if (miles <= 15) return {allowed:true, amountCents:0, band:"LOCAL"};
  if (miles <= 30) return {allowed:true, amountCents:7500, band:"MIDDLE"};
  if (miles <= 50) return {allowed:true, amountCents:12500, band:"OUTER"};
  return {allowed:false, amountCents:null, band:"MANUAL_ONLY"};
}
export const drivingEvidenceSchema = z.object({
  miles: z.number().finite().nonnegative().max(10000),
  source: z.enum(["VERIFIED_DRIVING_ROUTE", "OWNER_MANUAL_DRIVING_ROUTE"]),
  sourceReference: z.string().trim().min(8).max(500),
  measuredAt: z.iso.datetime(),
  origin: z.string().trim().min(5).max(300),
}).strict();
export function reviewedDrivingFee(raw: unknown, expectedOrigin: string,
  now = new Date()) {
  const evidence = drivingEvidenceSchema.parse(raw);
  if (!expectedOrigin || expectedOrigin.startsWith("UNVERIFIED:") ||
      evidence.origin !== expectedOrigin)
    throw new Error("Distance proof does not use a verified current origin.");
  const measured = new Date(evidence.measuredAt).getTime();
  if (!Number.isFinite(measured) || measured > now.getTime()+5*60*1000 ||
      now.getTime()-measured > 7*24*60*60*1000)
    throw new Error("Driving route proof is stale. Reverify or record a reviewed manual route.");
  const band = mileageBand(evidence.miles);
  if (!band.allowed) throw new Error("Outside automatic delivery bands. Require separate manual review.");
  return { ...band, evidence };
}
export async function saveDeliveryOffers(userId: string, estimateId: string,
  input: { date: string; window: "AM" | "PM" }[], autoFinish=false) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 4)
    throw new Error("Offer between one and four delivery choices.");
  const options = input.map(row => slotSchema.parse({ ...row, id:randomUUID() }));
  const seen = new Set<string>();
  for (const option of options) {
    const key = option.date + ":" + option.window;
    if (option.date < todayDenver() || seen.has(key))
      throw new Error("Offer only unique future delivery windows.");
    seen.add(key);
  }
  return prisma.$transaction(async tx => {
    const actor = await tx.user.findUnique({where:{id:userId},select:{role:true}});
    if (!actor || !["OWNER","ADMIN"].includes(actor.role))
      throw new Error("Owner/admin permission required.");
    const estimate = await tx.estimate.findUnique({
      where:{id:estimateId},select:{status:true,deliveryOfferVersion:true},
    });
    if (!estimate || !["DRAFT","CHANGES_REQUESTED","SENT","VIEWED"].includes(estimate.status))
      throw new Error("Cannot change delivery choices on an accepted order.");
    // An existing linked offer must be refreshed when choices change.
    const row = await tx.estimate.update({
      where:{id:estimateId},data:{deliveryOffer:options,
        deliveryOfferVersion:{increment:1},customerAutoFinishEnabled:autoFinish},
      select:{deliveryOfferVersion:true},
    });
    await tx.auditLog.create({data:{userId,action:"estimate.delivery_choices",
      entityType:"Estimate",entityId:estimateId,newValue:{count:options.length,
        version:row.deliveryOfferVersion,autoFinish,windows:options.map(x=>x.date+":"+x.window)}}});
    return {count:options.length,version:row.deliveryOfferVersion};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
export async function recordEstimateDeliverySelectionInTx(
  tx: Prisma.TransactionClient, estimate: {id:string;deliveryOffer:unknown;
    deliveryOfferVersion:number}, input: DeliverySelection) {
  const evidence = assertAvailableDeliveryOption(estimate.deliveryOffer,
    estimate.deliveryOfferVersion,input);
  await tx.estimate.update({where:{id:estimate.id},
    data:{deliveryRequested:evidence,deliveryRequestedAt:new Date()}});
  return evidence;
}
/** A retained quote decision cannot be turned into an appointment by the customer. */
export function isDeliveryRequested(value: {requestedDeliveryAt: Date | null;
  scheduledAt:Date | null;confirmedDeliveryAt:Date | null}) {
  return !!value.requestedDeliveryAt && !value.scheduledAt && !value.confirmedDeliveryAt;
}

/** Pure first-confirmation gate. A selected offer is not a scheduling approval. */
export function validateDeliveryConfirmation(input: {
  requested: unknown; scheduledAt: Date;
  windows: { morningStart:number;morningEnd:number;afternoonStart:number;afternoonEnd:number };
}) {
  if (!(input.scheduledAt instanceof Date) || !Number.isFinite(input.scheduledAt.getTime()))
    throw new Error("Invalid proposed delivery time.");
  const evidence = z.object({ slot: slotSchema }).passthrough().safeParse(input.requested);
  if(!evidence.success) throw new Error("No valid customer-requested delivery choice.");
  const time = new Intl.DateTimeFormat("en-GB",{ timeZone: DENVER,
    year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",
    hourCycle:"h23" }).formatToParts(input.scheduledAt);
  const val=(key:string)=>Number(time.find(x=>x.type===key)?.value);
  const date = [String(val("year")).padStart(4,"0"),String(val("month")).padStart(2,"0"),
    String(val("day")).padStart(2,"0")].join("-");
  if(date!==evidence.data.slot.date)
    throw new Error("Owner confirmation must match the offered local delivery date.");
  const minutes=val("hour")*60+val("minute");
  const start=(evidence.data.slot.window==="AM"?
    input.windows.morningStart:input.windows.afternoonStart)*60;
  const end=(evidence.data.slot.window==="AM"?
    input.windows.morningEnd:input.windows.afternoonEnd)*60;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||
     end>1440||start>=end||minutes<start||minutes>=end)
    throw new Error("Scheduled time is outside the customer's offered AM/PM window.");
  return {slot:evidence.data.slot,date,minutes};
}
