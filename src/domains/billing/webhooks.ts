import type Stripe from "stripe";

import { captureDepositProvenanceFromWebhook } from "./deposit-provenance";
import {
  processStripeWebhookEvent as processStripeWebhookEventBase,
  type StripeWebhookProcessingResult,
} from "./webhooks-base";

export type { StripeWebhookProcessingResult } from "./webhooks-base";

/**
 * Apply the established webhook business mutation first, then durably attach
 * deposit funding provenance. If the second step fails, the route returns an
 * error and Stripe retries; the base WebhookEvent guard makes the business
 * mutation idempotent while provenance gets another chance to attach.
 */
export async function processStripeWebhookEvent(
  event: Stripe.Event,
): Promise<StripeWebhookProcessingResult> {
  const result = await processStripeWebhookEventBase(event);
  await captureDepositProvenanceFromWebhook(event);
  return result;
}
