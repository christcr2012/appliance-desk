/** Vercel previews/development must not act on production providers.
 * No deployment marker means local/CI behavior is unchanged. A Vercel
 * deployment with a missing or unknown environment fails closed.
 */
export function isNonProductionDeployment(
  env: { VERCEL?: string; VERCEL_ENV?: string } = {
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
  },
): boolean {
  if (env.VERCEL_ENV !== undefined) return env.VERCEL_ENV !== "production";
  return env.VERCEL === "1";
}

export function assertPreviewStripeKey(secretKey: string | undefined): void {
  if (isNonProductionDeployment() && !/^(sk|rk)_test_/.test(secretKey ?? "")) {
    throw new Error("Preview billing requires a Stripe test key. Live or missing keys are refused.");
  }
}
