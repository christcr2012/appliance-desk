import { z } from "zod";

export const taskInputSchema = z.object({
  note: z.string().trim().min(1, "Give this task a short note.").max(500),
  dueDate: z.union([z.iso.date(), z.literal("")]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH"]).default("NORMAL"),
  assigneeUserId: z.string().trim().max(200).nullable().optional(),
  leadId: z.string().trim().max(200).nullable().optional(),
  customerId: z.string().trim().max(200).nullable().optional(),
  jobId: z.string().trim().max(200).nullable().optional(),
});
export type TaskInput = z.input<typeof taskInputSchema>;
export const taskVersionSchema = z.number().int().positive().max(2147483646);
export class TaskError extends Error {
  constructor(
    message: string,
    public readonly conflict = false,
  ) {
    super(message);
  }
}
