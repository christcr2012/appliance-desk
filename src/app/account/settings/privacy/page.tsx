import { portalLanguage } from "@/domains/language/portal";
import { portalLabel } from "@/domains/language/portal-copy";
import { requireSession } from "@/lib/session";
import { listPrivacyRequestsForCustomer } from "@/domains/privacy";
import { RecordHeader, StatusPill, EmptyState, type Tone } from "@/components/kit";
import { accountPrivacyRequestAction } from "./actions";

export const metadata = { title: "Privacy requests" };

function statusTone(status: string): Tone {
  if (status === "FULFILLED") return "good";
  if (status === "REJECTED") return "danger";
  return "neutral";
}

/** PORTAL-1 section 5.6: the privacy page keeps its forms and the
 * required retention sentence word for word; only the chrome moved to
 * the kit (RecordHeader, kit StatusPill, kit-token buttons). */
export default async function AccountPrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ requested?: string; error?: string }>;
}) {
  const session = await requireSession();
  const language = await portalLanguage(session.user.id);
  const t = (word: Parameters<typeof portalLabel>[1]) => portalLabel(language, word);
  const requests = await listPrivacyRequestsForCustomer(session.user.id);
  const params = await searchParams;

  return (
    <div className="max-w-3xl">
      <RecordHeader
        title={t("Privacy requests")}
        back={{ href: "/account/settings", label: t("Account") }}
      />

      <p className="mb-4 text-sm text-ink-soft">
        {t("Request a copy of the personal information connected to your account or ask us to delete personal information we are allowed to remove.")}
      </p>

      <p className="mb-6 text-sm text-ink-soft">
        {t("Billing, tax, signed-agreement and audit evidence may need to be retained.")}
      </p>

      {params.requested === "1" && (
        <p
          role="status"
          className="mb-6 rounded-card border border-line bg-subtle p-4 text-sm text-ink"
        >
          {t("Your request was recorded and your signed-in session verified your identity. The owner will process it.")}
        </p>
      )}
      {params.error === "1" && (
        <p role="alert" className="mb-6 text-sm font-semibold text-danger">
          {t("That request could not be recorded.")}
        </p>
      )}

      <section aria-label={t("Make a privacy request")} className="mb-6 rounded-card border border-line bg-surface px-4 py-3.5">
        <h2 className="text-base font-bold text-ink">{t("Make a privacy request")}</h2>
        <p className="mt-1 text-sm text-ink-soft">{t("Choose the request you want the owner to review.")}</p>
        <form
          action={accountPrivacyRequestAction}
          className="mt-3 flex flex-wrap gap-3"
        >
          <button
            type="submit"
            name="kind"
            value="EXPORT"
            className="inline-flex min-h-11 items-center rounded-control bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-dark"
          >
            {t("Request my data")}
          </button>
          <button
            type="submit"
            name="kind"
            value="DELETE"
            className="inline-flex min-h-11 items-center rounded-control border border-danger px-4 py-2 text-sm font-semibold text-danger hover:bg-tint"
          >
            {t("Request deletion")}
          </button>
        </form>
      </section>

      <section aria-label={t("Your requests")} className="rounded-card border border-line bg-surface px-4 py-3.5">
        <h2 className="text-base font-bold text-ink">{t("Your requests")}</h2>
        {requests.length === 0 ? (
          <div className="py-2">
            <EmptyState title={t("No privacy requests yet")} />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {requests.map((request) => (
              <li key={request.id} className="py-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-ink">
                    {request.kind === "EXPORT" ? t("Data export") : t("Deletion")}
                  </p>
                  <StatusPill
                    tone={statusTone(request.status)}
                    label={language === "es" ? t(({ RECEIVED: "received", VERIFIED: "verified", FULFILLED: "fulfilled", REJECTED: "rejected" } as const)[request.status] ?? "pending") : request.status.toLowerCase().replaceAll("_", " ")}
                  />
                </div>
                <p className="mt-2 text-ink-soft">
                  {t("Submitted")}{" "}
                  {request.createdAt.toLocaleDateString(language === "es" ? "es-US" : "en-US", { timeZone: "America/Denver" })}
                </p>
                {request.rejectedReason && (
                  <p className="mt-1 text-ink-soft">
                    {t("Reason")}: {request.rejectedReason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
