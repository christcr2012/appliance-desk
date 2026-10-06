import { Button, Card, Field } from "@/components/ui";
import { publicPrivacyRequestAction } from "./actions";

export function PrivacyRequestForm({ received = false }: { received?: boolean }) {
  return (
    <Card
      title="Make a privacy request"
      description="Ask for a copy of the personal information connected to your customer account, or ask us to delete personal information we are allowed to remove. We keep records that must remain for billing, tax, signed agreements and audit purposes."
    >
      {received && (
        <p
          role="status"
          className="mb-5 rounded-control border border-line bg-subtle p-3 text-sm text-ink"
        >
          If the email matches information we hold, verification instructions
          will be sent when customer email is enabled. Otherwise, the owner will
          review the request. For privacy, this message is the same for every
          email address.
        </p>
      )}
      <form
        action={publicPrivacyRequestAction}
        className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end"
      >
        <Field
          type="email"
          name="email"
          label="Email address"
          required
          autoComplete="email"
        />
        <Button type="submit" name="kind" value="EXPORT" variant="secondary">
          Request my data
        </Button>
        <Button type="submit" name="kind" value="DELETE" variant="secondary">
          Request deletion
        </Button>
      </form>
    </Card>
  );
}
