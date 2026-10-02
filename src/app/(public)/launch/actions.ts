"use server";

import { headers } from "next/headers";
import { joinLaunchList } from "@/domains/launch";
import {
  launchSignupSchema,
  type LaunchFormState,
} from "@/domains/launch/schema";
import { isRateLimited } from "@/lib/rate-limit";

const success: LaunchFormState = {
  status: "success",
  message:
    "Thanks! Your interest has been recorded. If you're already on our list, your preferences stay unchanged. Joining doesn't reserve an appliance.",
};

export async function submitLaunchSignup(
  _state: LaunchFormState,
  form: FormData,
): Promise<LaunchFormState> {
  if (form.get("website")) return success;
  const parsed = launchSignupSchema.safeParse({
    name: form.get("name"),
    email: form.get("email"),
    city: form.get("city"),
    interest: form.get("interest"),
    consent: form.get("consent") === "on",
    source: form.get("source") || "website",
    website: "",
  });
  if (!parsed.success)
    return {
      status: "error",
      message: "Please check the highlighted fields.",
      errors: parsed.error.flatten().fieldErrors,
    };
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";
  if (
    await isRateLimited(`launch:${ip}`, {
      max: 5,
      windowMs: 10 * 60 * 1000,
    })
  ) {
    return {
      status: "error",
      message: "Please wait a few minutes before trying again.",
    };
  }
  try {
    await joinLaunchList(parsed.data);
    return success;
  } catch {
    return {
      status: "error",
      message:
        "We couldn't save your signup. Please try again or use our contact form.",
    };
  }
}
