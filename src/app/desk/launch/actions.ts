"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  launchSettingsSchema,
  type LaunchFormState,
} from "@/domains/launch/schema";

export async function saveLaunchSettings(
  _state: LaunchFormState,
  form: FormData,
): Promise<LaunchFormState> {
  const session = await requireRole("OWNER", "ADMIN");
  const parsed = launchSettingsSchema.safeParse({
    prelaunchMode: form.get("prelaunchMode") === "on",
    emailEnabled: form.get("emailEnabled") === "on",
    postalAddress: form.get("postalAddress"),
    replyToEmail: form.get("replyToEmail"),
  });
  if (!parsed.success)
    return {
      status: "error",
      message: "Please check the highlighted fields.",
      errors: parsed.error.flatten().fieldErrors,
    };
  await prisma.$transaction([
    prisma.launchSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...parsed.data },
      update: parsed.data,
    }),
    prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: "launch.settings.updated",
        entityType: "LaunchSettings",
        entityId: "singleton",
        newValue: parsed.data,
      },
    }),
  ]);
  revalidatePath("/", "layout");
  return { status: "success", message: "Launch settings saved." };
}

export async function suppressLaunchSubscriber(form: FormData) {
  const session = await requireRole("OWNER", "ADMIN");
  const id = form.get("id");
  if (typeof id !== "string" || id.length > 100)
    throw new Error("Invalid subscriber");
  await prisma.$transaction([
    prisma.launchSubscriber.update({
      where: { id },
      data: { unsubscribedAt: new Date() },
    }),
    prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: "launch.subscriber.suppressed",
        entityType: "LaunchSubscriber",
        entityId: id,
      },
    }),
  ]);
  revalidatePath("/desk/launch");
}
