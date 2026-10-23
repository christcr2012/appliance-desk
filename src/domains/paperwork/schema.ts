import { z } from "zod";
import { PAPERWORK_GROUPS } from "./rules";

const optionalText = (max: number) =>
  z.string().trim().max(max).transform((v) => (v === "" ? null : v)).nullable().optional();
const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .refine((v) => v == null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use a date like 2027-03-15.");

export const paperworkInputSchema = z.object({
  title: z.string().trim().min(2, "Give it a name.").max(120),
  groupName: z.enum(PAPERWORK_GROUPS),
  status: z.enum(["TO_DO", "IN_PROGRESS", "DONE", "NOT_NEEDED"]),
  whatItIs: optionalText(1500),
  agency: optionalText(120),
  officialUrl: optionalText(300).refine(
    (v) => v == null || /^https:\/\/[^\s]+$/.test(v),
    "A website address must start with https://",
  ),
  referenceNumber: optionalText(80),
  startedOn: optionalDate,
  dueOn: optionalDate,
  remindDaysBefore: z.coerce.number().int().min(0).max(365).default(30),
  repeatEveryMonths: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(120)])
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  notes: optionalText(2000),
});
export type PaperworkInput = z.infer<typeof paperworkInputSchema>;
