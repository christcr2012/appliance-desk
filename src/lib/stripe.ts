import Stripe from "stripe";
import { assertPreviewStripeKey } from "./deployment-safety";

// Shared Stripe client — see docs/ARCHITECTURE.md's "Payments (Stripe)"
// section. STRIPE_SECRET_KEY is a Vercel environment variable (test-mode
// only until Chris explicitly authorizes going live — see AGENTS.md and
// docs/BUSINESS-RULES.md's billing rules). Lazily constructed so that
// importing this module never fails just because the key isn't set in an
// environment that doesn't need it (e.g. a script that never touches
// billing) — the error only surfaces when billing code actually runs.
let cachedClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  // Check before the cache: a previously constructed client must not
  // bypass environment validation on a later call.
  assertPreviewStripeKey(process.env.STRIPE_SECRET_KEY);
  if (cachedClient) return cachedClient;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Billing features can't run without it — see docs/ARCHITECTURE.md.",
    );
  }

  cachedClient = new Stripe(secretKey);
  return cachedClient;
}

/** Only for tests: lets a test swap in a fake/mocked client and reset the
 * cache afterward, without touching real env vars. */
export function __setStripeClientForTests(client: Stripe | null): void {
  cachedClient = client;
}
