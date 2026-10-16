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
export function reviewedDrivingFee(raw: unknown, expectedOrigin: string) {
  const evidence = drivingEvidenceSchema.parse(raw);
  if (evidence.origin !== expectedOrigin)
    throw new Error("Distance proof does not use the currently configured origin.");
  const band = mileageBand(evidence.miles);
  if (!band.allowed) throw new Error("Outside automatic delivery bands. Require separate manual review.");
  return { ...band, evidence };
}
export async function saveDeliveryOffers(userId: string, estimateId: string,
  input: { date: string; window: "AM" | "PM" }[]) {
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
        deliveryOfferVersion:{increment:1}},
      select:{deliveryOfferVersion:true},
    });
    await tx.auditLog.create({data:{userId,action:"estimate.delivery_choices",
      entityType:"Estimate",entityId:estimateId,newValue:{count:options.length,
        version:row.deliveryOfferVersion,windows:options.map(x=>x.date+":"+x.window)}}});
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
