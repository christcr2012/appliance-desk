import { isNonProductionDeployment } from "@/lib/deployment-safety";
type ProviderEnv = {
  VERCEL?: string;
  VERCEL_ENV?: string;
  RESEND_API_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_PHONE_NUMBER?: string;
  BLOB_READ_WRITE_TOKEN?: string;
};
export function providerStatus(
  env: ProviderEnv = {
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
  },
) {
  const isolated = isNonProductionDeployment(env);
  const notification = (configured: boolean) =>
    !configured
      ? "Not fully configured; sending unavailable"
      : isolated
        ? "Configured; sending suppressed in this preview"
        : "Configured; delivery still requires verification";
  const paymentMode = /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY ?? "")
    ? "Test key configured"
    : /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? "")
      ? "Live key configured; payment processing still requires verification"
      : "No recognized payment key configured";
  return [
    { name: "Email", state: notification(Boolean(env.RESEND_API_KEY)) },
    {
      name: "SMS",
      state: notification(
        Boolean(
          env.TWILIO_ACCOUNT_SID &&
          env.TWILIO_AUTH_TOKEN &&
          env.TWILIO_PHONE_NUMBER,
        ),
      ),
    },
    {
      name: "Payments",
      state:
        isolated && !/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY ?? "")
          ? "Unavailable in this preview; a test key is required"
          : paymentMode,
    },
    {
      name: "Payment synchronization",
      state: env.STRIPE_WEBHOOK_SECRET
        ? "Webhook secret configured; event processing must be verified"
        : "Webhook secret not configured",
    },
    {
      name: "Photos and backup storage",
      state: isolated
        ? "Preview writes disabled until independent storage is verified"
        : env.BLOB_READ_WRITE_TOKEN
          ? "Storage credential configured; file and recovery checks remain separate"
          : "Storage not configured",
    },
  ];
}
