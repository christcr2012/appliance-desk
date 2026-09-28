import Link from "next/link";
import { NewCustomerForm } from "./new-customer-form";

export const metadata = { title: "Add a customer" };

export default function NewCustomerPage() {
  return (
    <div>
      <Link href="/desk/customers" className="text-sm text-gray-600 hover:underline">
        &larr; Back to customers
      </Link>

      <h1 className="mt-2 text-xl font-semibold">Add a customer</h1>
      <p className="mt-1 text-sm text-gray-600">
        For someone you&apos;re signing up directly — a call-in, a walk-in, or a
        property manager you&apos;ve already been talking to. A website inquiry
        still comes in as a lead first; convert it from{" "}
        <Link href="/desk/leads" className="underline">
          Leads
        </Link>{" "}
        instead.
      </p>

      <div className="mt-6">
        <NewCustomerForm />
      </div>
    </div>
  );
}
