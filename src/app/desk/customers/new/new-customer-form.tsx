"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCustomerAction } from "../actions";

type AddressFields = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
};

const EMPTY_ADDRESS: AddressFields = {
  line1: "",
  line2: "",
  city: "",
  state: "CO",
  zip: "",
};

export function NewCustomerForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isPropertyManager, setIsPropertyManager] = useState(false);
  const [isBusiness, setIsBusiness] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [addresses, setAddresses] = useState<AddressFields[]>([{ ...EMPTY_ADDRESS }]);
  // Only ever holds an error now — a success navigates straight to the
  // new customer's page (see handleSubmit below), so there's no longer
  // a "success" message state to show here.
  const [message, setMessage] = useState<{ kind: "error"; text: string } | null>(
    null,
  );

  function updateAddress(index: number, field: keyof AddressFields, value: string) {
    setAddresses((rows) =>
      rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
  }

  function addAddress() {
    setAddresses((rows) => [...rows, { ...EMPTY_ADDRESS }]);
  }

  function removeAddress(index: number) {
    setAddresses((rows) => rows.filter((_, i) => i !== index));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await createCustomerAction({
        name,
        email,
        phone,
        isBusiness,
        isPropertyManager,
        companyName,
        addresses: addresses.map((a) => ({
          line1: a.line1,
          line2: a.line2,
          city: a.city,
          state: a.state,
          zip: a.zip,
        })),
      });

      if (result.status !== "success") {
        setMessage({
          kind: "error",
          text: result.status === "error" ? result.message : "Couldn't add that customer.",
        });
        return;
      }

      // Carried on the URL rather than shown here — router.push below
      // navigates to the new customer's own page right away, so a
      // message set in this component's state would never actually be
      // seen (2026-09-29, Chris reported: "the new customer process
      // doesn't seem to actually send an email" — it does; he just had
      // no way to tell, since this success banner used to flash off-
      // screen the instant the page navigated away). The customer
      // detail page reads these query params and shows the same
      // confirmation there instead, where it's actually visible.
      const params = new URLSearchParams();
      if (result.isNewAccount) {
        params.set("newAccount", "1");
        params.set("emailSent", result.activationEmailSent ? "1" : "0");
      }
      router.push(
        `/desk/customers/${result.customerId}${params.size > 0 ? `?${params.toString()}` : ""}`,
      );
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-2xl space-y-6 rounded-lg border border-gray-200 bg-white p-5"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">
            Name
          </label>
          <input
            id="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">
            They&apos;ll sign in with this — we&apos;ll email them a link to set
            their own password.
          </p>
        </div>
        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
            Phone
          </label>
          <input
            id="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="companyName" className="block text-sm font-medium text-gray-700">
            Company name (if any)
          </label>
          <input
            id="companyName"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={isBusiness}
            onChange={(e) => setIsBusiness(e.target.checked)}
          />
          This is a business account
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={isPropertyManager}
            onChange={(e) => setIsPropertyManager(e.target.checked)}
          />
          They&apos;re a landlord, property manager, or apartment operator
          managing multiple properties
        </label>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-gray-900">
            {isPropertyManager ? "Properties" : "Property"}
          </h2>
          {isPropertyManager && (
            <button
              type="button"
              onClick={addAddress}
              className="text-sm text-primary hover:underline"
            >
              + Add another property
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-600">
          {isPropertyManager
            ? "Add every property they manage now, or come back and add more later from their customer page."
            : "The address they're renting at."}
        </p>

        <div className="mt-3 space-y-4">
          {addresses.map((address, index) => (
            <div
              key={index}
              className="rounded-md border border-gray-200 p-3"
            >
              {addresses.length > 1 && (
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500">
                    Property {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAddress(index)}
                    className="text-xs text-gray-500 hover:text-gray-900"
                  >
                    Remove
                  </button>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-700">
                    Street address
                  </label>
                  <input
                    required
                    value={address.line1}
                    onChange={(e) => updateAddress(index, "line1", e.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-700">
                    Unit / apt (optional)
                  </label>
                  <input
                    value={address.line2}
                    onChange={(e) => updateAddress(index, "line2", e.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700">City</label>
                  <input
                    required
                    value={address.city}
                    onChange={(e) => updateAddress(index, "city", e.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700">State</label>
                    <input
                      value={address.state}
                      onChange={(e) => updateAddress(index, "state", e.target.value)}
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700">ZIP</label>
                    <input
                      required
                      value={address.zip}
                      onChange={(e) => updateAddress(index, "zip", e.target.value)}
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {message && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {message.text}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {isPending ? "Adding…" : "Add customer"}
      </button>
    </form>
  );
}
