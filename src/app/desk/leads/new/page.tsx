import Link from "next/link";
import { NewLeadForm } from "./new-lead-form";

export const metadata = { title: "Add a lead" };

export default function NewLeadPage() {
  return (
    <div>
      <Link href="/desk/leads" className="text-sm text-gray-600 hover:underline">
        &larr; Back to leads
      </Link>

      <h1 className="mt-2 text-xl font-semibold">Add a lead</h1>
      <p className="mt-1 text-sm text-gray-600">
        For an inquiry that didn&apos;t come through the website — a phone
        call, a walk-in, someone you met. It goes into the same pipeline as
        a website inquiry, scored and tracked the same way. Not ready to
        sign anyone up yet — for someone you want to sign up directly, use{" "}
        <Link href="/desk/customers/new" className="underline">
          Add a customer
        </Link>{" "}
        instead.
      </p>

      <div className="mt-6">
        <NewLeadForm />
      </div>
    </div>
  );
}
