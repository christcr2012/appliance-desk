"use client";

import { useRef, useState, useTransition } from "react";
import { formatCents } from "@/domains/pricing/money";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createDraftAgreementAction,
  addRentalLineAction,
  sendForSignatureAction,
} from "../actions";
import { createCustomerAction } from "../../customers/actions";
import { formatTaxRate } from "@/domains/billing/tax";

// ---------------------------------------------------------------------------
// Guided rental builder wizard (2026-09-28) — walks Chris through setting
// up a new rental step by step instead of the previous two disconnected
// pages (a "new agreement" form, then a separate agreement page to add
// appliances and send for signature). Each step calls the exact same
// server actions those two pages already used — this is a guided
// sequence over existing, already-tested logic, not a new creation path.
// ---------------------------------------------------------------------------

type CustomerOption = {
  id: string;
  name: string;
  serviceAddresses: { id: string; label: string }[];
};

type ApplianceOption = { id: string; assetNumber: string; typeName: string };

type Step = "customer" | "terms" | "appliances" | "review";

const STEPS: { key: Step; label: string }[] = [
  { key: "customer", label: "Customer" },
  { key: "terms", label: "Term & fees" },
  { key: "appliances", label: "Appliances" },
  { key: "review", label: "Review & send" },
];

const EMPTY_TERM_FIELDS = {
  termMonths: "",
  depositDollars: "",
  damageWaiverDollars: "",
  lateFeeGraceDays: "5",
  lateFeeDollars: "",
  lateFeePercent: "",
  taxRatePercent: "",
  paidInFullInAdvance: false,
};

const EMPTY_NEW_CUSTOMER = {
  name: "",
  email: "",
  phone: "",
  isBusiness: false,
  isPropertyManager: false,
  companyName: "",
  line1: "",
  line2: "",
  city: "",
  state: "CO",
  zip: "",
};

type AddedLine = {
  id: string;
  label: string;
  monthlyPriceCents: number;
  applianceNames: string;
};
type SavedDraft = {
  id: string;
  customerId: string;
  customerName: string;
  serviceAddressId: string;
  termMonths: number | null;
  depositCents: number;
  damageWaiverCents: number;
  lateFeeGraceDays: number;
  lateFeeCents: number;
  lateFeePercent: number;
  taxRateMilliPercent: number;
  paidInFullInAdvance: boolean;
  lines: AddedLine[];
};

export function RentalWizard({
  customers,
  availableAppliances: initialAvailableAppliances,
  initialCustomerId,
  initialServiceAddressId,
  initialDraft,
  initialRequestKey,
  defaultTaxRatePercent = "",
}: {
  customers: CustomerOption[];
  availableAppliances: ApplianceOption[];
  initialCustomerId?: string;
  initialServiceAddressId?: string;
  initialDraft?: SavedDraft;
  initialRequestKey?: string;
  defaultTaxRatePercent?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>(
    initialDraft
      ? initialDraft.lines.length
        ? "review"
        : "appliances"
      : "customer",
  );
  const requestKey = useRef(initialRequestKey);
  const [error, setError] = useState<string | null>(null);
  const [activationWarning, setActivationWarning] = useState<string | null>(null);

  // Step 1 — customer
  const [customerMode, setCustomerMode] = useState<"existing" | "new">(
    initialCustomerId ? "existing" : customers.length > 0 ? "existing" : "new",
  );
  const [customerId, setCustomerId] = useState(
    initialCustomerId ?? customers[0]?.id ?? "",
  );
  const [customerName, setCustomerName] = useState(
    initialDraft?.customerName ??
      customers.find((c) => c.id === (initialCustomerId ?? customers[0]?.id))
        ?.name ??
      "",
  );
  const [addresses, setAddresses] = useState(
    customers.find((c) => c.id === (initialCustomerId ?? customers[0]?.id))
      ?.serviceAddresses ?? [],
  );
  const [serviceAddressId, setServiceAddressId] = useState(
    addresses.some((a) => a.id === initialServiceAddressId)
      ? initialServiceAddressId!
      : (addresses[0]?.id ?? ""),
  );
  const [newCustomer, setNewCustomer] = useState(EMPTY_NEW_CUSTOMER);

  function updateNewCustomer<K extends keyof typeof EMPTY_NEW_CUSTOMER>(
    key: K,
    value: (typeof EMPTY_NEW_CUSTOMER)[K],
  ) {
    setNewCustomer((f) => ({ ...f, [key]: value }));
  }

  function handleExistingCustomerChange(id: string) {
    setCustomerId(id);
    const c = customers.find((x) => x.id === id);
    setCustomerName(c?.name ?? "");
    setAddresses(c?.serviceAddresses ?? []);
    setServiceAddressId(c?.serviceAddresses[0]?.id ?? "");
  }

  function handleCustomerStepNext(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (customerMode === "existing") {
      if (!customerId) {
        setError("Choose a customer.");
        return;
      }
      if (!serviceAddressId) {
        setError(
          "This customer doesn't have a service address on file yet — add one from their customer page first, or choose a different customer.",
        );
        return;
      }
      setStep("terms");
      return;
    }

    startTransition(async () => {
      let result;
      try {
        result = await createCustomerAction({
          name: newCustomer.name,
          email: newCustomer.email,
          phone: newCustomer.phone,
          isBusiness: newCustomer.isBusiness,
          isPropertyManager: newCustomer.isPropertyManager,
          companyName: newCustomer.companyName,
          addresses: [
            {
              line1: newCustomer.line1,
              line2: newCustomer.line2,
              city: newCustomer.city,
              state: newCustomer.state,
              zip: newCustomer.zip,
            },
          ],
        });
      } catch {
        setError(
          "Customer creation was not confirmed. Check the customer list before retrying; your inputs are still here.",
        );
        return;
      }
      if (result.status !== "success") {
        setError(
          result.status === "error"
            ? result.message
            : "Couldn't add that customer.",
        );
        return;
      }
      setActivationWarning(result.isNewAccount && !result.activationEmailSent ? result.customerId : null);
      setCustomerId(result.customerId);
      setCustomerName(newCustomer.name);
      const created = result.serviceAddresses.map((a) => ({
        id: a.id,
        label: `${a.line1}, ${a.city}, ${a.state} ${a.zip}`,
      }));
      setAddresses(created);
      setServiceAddressId(created[0]?.id ?? "");
      setStep("terms");
    });
  }

  // Step 2 — term & fees
  const [termFields, setTermFields] = useState(
    initialDraft
      ? {
          termMonths: initialDraft.termMonths?.toString() ?? "",
          depositDollars: (initialDraft.depositCents / 100).toString(),
          damageWaiverDollars: (
            initialDraft.damageWaiverCents / 100
          ).toString(),
          lateFeeGraceDays: initialDraft.lateFeeGraceDays.toString(),
          lateFeeDollars: (initialDraft.lateFeeCents / 100).toString(),
          lateFeePercent: initialDraft.lateFeePercent.toString(),
          taxRatePercent: initialDraft.taxRateMilliPercent
            ? formatTaxRate(initialDraft.taxRateMilliPercent).replace("%", "")
            : "",
          paidInFullInAdvance: initialDraft.paidInFullInAdvance,
        }
      : { ...EMPTY_TERM_FIELDS, taxRatePercent: defaultTaxRatePercent },
  );
  const [agreementId, setAgreementId] = useState<string | null>(
    initialDraft?.id ?? null,
  );

  function updateTerm<K extends keyof typeof EMPTY_TERM_FIELDS>(
    key: K,
    value: (typeof EMPTY_TERM_FIELDS)[K],
  ) {
    setTermFields((f) => ({ ...f, [key]: value }));
  }

  function handleTermsStepNext(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // Already created (e.g. Chris went back a step to double-check
    // something) — no need to create a second draft.
    if (agreementId) {
      setStep("appliances");
      return;
    }
    startTransition(async () => {
      requestKey.current ??= crypto.randomUUID();
      const params = new URLSearchParams(window.location.search);
      params.set("requestKey", requestKey.current);
      params.set("customerId", customerId);
      params.set("serviceAddressId", serviceAddressId);
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}?${params}`,
      );
      let result;
      try {
        result = await createDraftAgreementAction({
          requestKey: requestKey.current,
          customerId,
          serviceAddressId,
          ...termFields,
        });
      } catch {
        setError(
          "The draft save was not confirmed. Reload this page to recover the saved draft before trying again.",
        );
        return;
      }
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setAgreementId(result.agreementId);
      if (result.agreementStatus !== "DRAFT") {
        router.push(`/desk/agreements/${result.agreementId}`);
        return;
      }
      window.history.replaceState(
        null,
        "",
        `/desk/agreements/new?draftId=${encodeURIComponent(result.agreementId)}`,
      );
      setStep("appliances");
    });
  }

  // Step 3 — appliances
  const [availableAppliances, setAvailableAppliances] = useState(
    initialAvailableAppliances,
  );
  const [addedLines, setAddedLines] = useState<AddedLine[]>(
    initialDraft?.lines ?? [],
  );
  const [label, setLabel] = useState("");
  const [listPriceDollars, setListPriceDollars] = useState("");
  const [selectedApplianceIds, setSelectedApplianceIds] = useState<string[]>(
    [],
  );

  function toggleAppliance(id: string) {
    setSelectedApplianceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function handleAddLine(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!agreementId) return;
    startTransition(async () => {
      let result;
      try {
        result = await addRentalLineAction(agreementId, {
          label,
          listPriceDollars,
          applianceIds: selectedApplianceIds,
        });
      } catch {
        setError(
          "The appliance save was not confirmed. Reload the saved draft to check its lines before retrying. Your inputs are still here.",
        );
        return;
      }
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      const names = availableAppliances
        .filter((a) => selectedApplianceIds.includes(a.id))
        .map((a) => `${a.typeName} (${a.assetNumber})`)
        .join(", ");
      setAddedLines((prev) => [
        ...prev,
        { ...result.line, applianceNames: names },
      ]);
      setAvailableAppliances((prev) =>
        prev.filter((a) => !selectedApplianceIds.includes(a.id)),
      );
      setLabel("");
      setListPriceDollars("");
      setSelectedApplianceIds([]);
    });
  }

  function handleAppliancesStepNext() {
    setError(null);
    if (addedLines.length === 0) {
      setError("Add at least one appliance before continuing.");
      return;
    }
    setStep("review");
  }

  // Step 4 — review & send
  const [sent, setSent] = useState(false);

  function handleSend() {
    setError(null);
    if (!agreementId) return;
    startTransition(async () => {
      let result;
      try {
        result = await sendForSignatureAction(agreementId);
      } catch {
        setError(
          "Sending was not confirmed. Open the saved agreement to check its signature status before retrying.",
        );
        return;
      }
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setSent(true);
    });
  }

  const monthlyTotal = addedLines.reduce(
    (sum, l) => sum + l.monthlyPriceCents,
    0,
  );

  return (
    <div>
      <ol className="flex flex-wrap gap-2" aria-label="Rental builder steps">
        {STEPS.map((s, i) => {
          const currentIndex = STEPS.findIndex((x) => x.key === step);
          const done =
            i < currentIndex || (agreementId && s.key === "customer");
          const active = s.key === step;
          return (
            <li
              key={s.key}
              aria-current={active ? "step" : undefined}
              className={`rounded-full border px-3 py-1 text-sm ${
                active
                  ? "border-gray-900 bg-gray-900 text-white"
                  : done
                    ? "border-green-300 bg-green-50 text-green-800"
                    : "border-gray-300 text-gray-500"
              }`}
            >
              {i + 1}. {s.label}
            </li>
          );
        })}
      </ol>

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      )}

      {activationWarning && (
        <p role="alert" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Customer saved, but the setup email was not sent. They cannot sign in
          until they set their password. Open their{" "}
          <Link href={`/desk/customers/${activationWarning}`} className="underline">
            customer record
          </Link>{" "}
          and use Resend activation email. Do not create another customer.
        </p>
      )}

      {agreementId && (
        <div
          role="status"
          className="mt-4 rounded-lg border border-line bg-subtle p-4 text-sm text-ink"
        >
          Draft saved. Customer, property and terms are fixed for this draft.
          Appliance lines are saved as you add them.{" "}
          <Link
            className="underline"
            href={`/desk/agreements/new?draftId=${agreementId}`}
          >
            Resume saved builder
          </Link>{" "}
          ·{" "}
          <Link className="underline" href={`/desk/agreements/${agreementId}`}>
            Open saved agreement
          </Link>
        </div>
      )}
      {agreementId && (step === "customer" || step === "terms") && (
        <div className="mt-4 space-y-3 rounded-lg border border-line bg-surface p-4">
          <h2 className="font-semibold">Saved customer and terms</h2>
          <p>
            {customerName} ·{" "}
            {termFields.termMonths
              ? `${termFields.termMonths}-month term`
              : "Month-to-month"}
          </p>
          <p className="text-sm text-ink-soft">
            To use different terms, open a separate draft. This checkpoint
            preserves the saved agreement.
          </p>
          <button
            type="button"
            disabled={isPending}
            onClick={() => setStep("appliances")}
            className="min-h-11 rounded-lg bg-action px-4 py-2 text-on-action"
          >
            Continue with saved draft
          </button>
        </div>
      )}
      {step === "customer" && !agreementId && (
        <form
          onSubmit={handleCustomerStepNext}
          className="mt-4 space-y-4 rounded-lg border border-gray-200 bg-white p-5"
        >
          <h2 className="font-medium text-gray-900">Who is this rental for?</h2>

          {customers.length > 0 && (
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  disabled={isPending}
                  type="radio"
                  checked={customerMode === "existing"}
                  onChange={() => setCustomerMode("existing")}
                />
                Existing customer
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  disabled={isPending}
                  type="radio"
                  checked={customerMode === "new"}
                  onChange={() => setCustomerMode("new")}
                />
                New customer
              </label>
            </div>
          )}

          {customerMode === "existing" ? (
            <>
              <div>
                <label
                  htmlFor="customerId"
                  className="block text-sm font-medium text-gray-700"
                >
                  Customer
                </label>
                <select
                  disabled={isPending}
                  id="customerId"
                  value={customerId}
                  onChange={(e) => handleExistingCustomerChange(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="serviceAddressId"
                  className="block text-sm font-medium text-gray-700"
                >
                  Service address
                </label>
                {addresses.length === 0 ? (
                  <p className="mt-1 text-sm text-red-700">
                    This customer has no service address on file yet.
                  </p>
                ) : (
                  <select
                    disabled={isPending}
                    id="serviceAddressId"
                    value={serviceAddressId}
                    onChange={(e) => setServiceAddressId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  >
                    {addresses.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="ncName"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Name
                  </label>
                  <input
                    disabled={isPending}
                    id="ncName"
                    type="text"
                    required
                    value={newCustomer.name}
                    onChange={(e) => updateNewCustomer("name", e.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label
                    htmlFor="ncEmail"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Email
                  </label>
                  <input
                    disabled={isPending}
                    id="ncEmail"
                    type="email"
                    required
                    value={newCustomer.email}
                    onChange={(e) => updateNewCustomer("email", e.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="ncPhone"
                  className="block text-sm font-medium text-gray-700"
                >
                  Phone (optional)
                </label>
                <input
                  disabled={isPending}
                  id="ncPhone"
                  type="tel"
                  value={newCustomer.phone}
                  onChange={(e) => updateNewCustomer("phone", e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm sm:w-64"
                />
              </div>
              <fieldset className="border-t border-gray-100 pt-3">
                <legend className="text-sm font-medium text-gray-700">
                  Service address
                </legend>
                <div className="mt-2 space-y-3">
                  <div>
                    <label htmlFor="nc-line1" className="mb-1 block text-sm font-medium text-gray-700">
                      Street address
                    </label>
                    <input
                      id="nc-line1"
                      autoComplete="street-address"
                      disabled={isPending}
                      type="text"
                      required
                      placeholder="Street address"
                      value={newCustomer.line1}
                      onChange={(e) => updateNewCustomer("line1", e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="nc-line2" className="mb-1 block text-sm font-medium text-gray-700">
                      Apartment / unit (optional)
                    </label>
                    <input
                      id="nc-line2"
                      autoComplete="address-line2"
                      disabled={isPending}
                      type="text"
                      placeholder="Apt / unit (optional)"
                      value={newCustomer.line2}
                      onChange={(e) => updateNewCustomer("line2", e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label htmlFor="nc-city" className="mb-1 block text-sm font-medium text-gray-700">
                        City
                      </label>
                      <input
                        id="nc-city"
                        autoComplete="address-level2"
                        disabled={isPending}
                        type="text"
                        required
                        placeholder="City"
                        value={newCustomer.city}
                        onChange={(e) => updateNewCustomer("city", e.target.value)}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label htmlFor="nc-state" className="mb-1 block text-sm font-medium text-gray-700">
                        State
                      </label>
                      <input
                        id="nc-state"
                        autoComplete="address-level1"
                        disabled={isPending}
                        type="text"
                        maxLength={2}
                        placeholder="State"
                        value={newCustomer.state}
                        onChange={(e) => updateNewCustomer("state", e.target.value)}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label htmlFor="nc-zip" className="mb-1 block text-sm font-medium text-gray-700">
                        ZIP
                      </label>
                      <input
                        id="nc-zip"
                        autoComplete="postal-code"
                        disabled={isPending}
                        type="text"
                        required
                        placeholder="ZIP"
                        value={newCustomer.zip}
                        onChange={(e) => updateNewCustomer("zip", e.target.value)}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                </div>
              </fieldset>
            </>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {isPending ? "Working…" : "Next: term & fees"}
          </button>
        </form>
      )}

      {step === "terms" && !agreementId && (
        <form
          onSubmit={handleTermsStepNext}
          className="mt-4 space-y-4 rounded-lg border border-gray-200 bg-white p-5"
        >
          <h2 className="font-medium text-gray-900">
            Term & fees for {customerName}
          </h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="termMonths"
                className="block text-sm font-medium text-gray-700"
              >
                Term (months, optional)
              </label>
              <input
                disabled={isPending}
                id="termMonths"
                type="number"
                min={1}
                placeholder="Leave blank for month-to-month"
                value={termFields.termMonths}
                onChange={(e) => {
                  const value = e.target.value;
                  updateTerm("termMonths", value);
                  if (value !== "12") updateTerm("paidInFullInAdvance", false);
                }}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              {(termFields.termMonths === "6" ||
                termFields.termMonths === "12") && (
                <p className="mt-1 text-xs text-gray-500">
                  A {termFields.termMonths}-month term automatically gets the{" "}
                  {termFields.termMonths}-month prepay discount (set from
                  /desk/settings).
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="depositDollars"
                className="block text-sm font-medium text-gray-700"
              >
                Deposit ($, optional)
              </label>
              <input
                disabled={isPending}
                id="depositDollars"
                type="number"
                min={0}
                step="0.01"
                value={termFields.depositDollars}
                onChange={(e) => updateTerm("depositDollars", e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          {termFields.termMonths === "12" && (
            <label className="flex items-center gap-2 rounded-md bg-blue-50 p-3 text-sm text-blue-900">
              <input
                disabled={isPending}
                type="checkbox"
                checked={termFields.paidInFullInAdvance}
                onChange={(e) =>
                  updateTerm("paidInFullInAdvance", e.target.checked)
                }
                className="h-4 w-4"
              />
              Customer is paying the full 12 months in advance (earns the
              free-month bonus, if that&apos;s turned on in Settings)
            </label>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="damageWaiverDollars"
                className="block text-sm font-medium text-gray-700"
              >
                Damage waiver ($, one time at signing, optional)
              </label>
              <input
                disabled={isPending}
                id="damageWaiverDollars"
                type="number"
                min={0}
                step="0.01"
                value={termFields.damageWaiverDollars}
                onChange={(e) =>
                  updateTerm("damageWaiverDollars", e.target.value)
                }
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="taxRatePercent"
                className="block text-sm font-medium text-gray-700"
              >
                Tax rate (%, optional)
              </label>
              <input
                disabled={isPending}
                id="taxRatePercent"
                type="text"
                inputMode="decimal"
                placeholder="e.g. 7.375"
                value={termFields.taxRatePercent}
                onChange={(e) => updateTerm("taxRatePercent", e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label
                htmlFor="lateFeeGraceDays"
                className="block text-sm font-medium text-gray-700"
              >
                Late fee grace (days)
              </label>
              <input
                disabled={isPending}
                id="lateFeeGraceDays"
                type="number"
                min={0}
                value={termFields.lateFeeGraceDays}
                onChange={(e) => updateTerm("lateFeeGraceDays", e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="lateFeeDollars"
                className="block text-sm font-medium text-gray-700"
              >
                Late fee flat ($)
              </label>
              <input
                disabled={isPending}
                id="lateFeeDollars"
                type="number"
                min={0}
                step="0.01"
                value={termFields.lateFeeDollars}
                onChange={(e) => updateTerm("lateFeeDollars", e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="lateFeePercent"
                className="block text-sm font-medium text-gray-700"
              >
                Late fee (%)
              </label>
              <input
                disabled={isPending}
                id="lateFeePercent"
                type="number"
                min={0}
                step="0.01"
                value={termFields.lateFeePercent}
                onChange={(e) => updateTerm("lateFeePercent", e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => setStep("customer")}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:border-gray-400"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {isPending ? "Working…" : "Next: appliances"}
            </button>
          </div>
        </form>
      )}

      {step === "appliances" && agreementId && (
        <div className="mt-4 space-y-4 rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="font-medium text-gray-900">
            Appliances ({addedLines.length} added
            {monthlyTotal > 0 && ` — ${formatCents(monthlyTotal)}/mo`})
          </h2>

          {addedLines.length > 0 && (
            <ul className="divide-y divide-gray-100 text-sm">
              {addedLines.map((l) => (
                <li key={l.id} className="py-2">
                  <p className="font-medium text-gray-900">
                    {l.label} — {formatCents(l.monthlyPriceCents)}/mo
                  </p>
                  <p className="text-gray-600">{l.applianceNames}</p>
                </li>
              ))}
            </ul>
          )}

          <form
            onSubmit={handleAddLine}
            className="space-y-3 border-t border-gray-100 pt-4"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="lineLabel"
                  className="block text-sm font-medium text-gray-700"
                >
                  Label
                </label>
                <input
                  disabled={isPending}
                  id="lineLabel"
                  type="text"
                  required
                  placeholder="e.g. Washer/Dryer set"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="listPriceDollars"
                  className="block text-sm font-medium text-gray-700"
                >
                  Monthly price before any discount ($)
                </label>
                <input
                  disabled={isPending}
                  id="listPriceDollars"
                  type="number"
                  min={0}
                  step="0.01"
                  required
                  value={listPriceDollars}
                  onChange={(e) => setListPriceDollars(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <p className="block text-sm font-medium text-gray-700">
                Which appliance(s)? (select 2 for a set — sets get the higher
                prepay discount rate)
              </p>
              {availableAppliances.length === 0 ? (
                <p className="mt-1 text-sm text-gray-600">
                  No available appliances in inventory right now.
                </p>
              ) : (
                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-md border border-gray-200 p-2">
                  {availableAppliances.map((a) => (
                    <label
                      key={a.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        disabled={isPending}
                        type="checkbox"
                        checked={selectedApplianceIds.includes(a.id)}
                        onChange={() => toggleAppliance(a.id)}
                      />
                      {a.typeName} ({a.assetNumber})
                    </label>
                  ))}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={isPending || availableAppliances.length === 0}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:border-gray-400 disabled:opacity-50"
            >
              {isPending ? "Adding…" : "Add to agreement"}
            </button>
          </form>

          <div className="flex gap-2 border-t border-gray-100 pt-4">
            <button
              type="button"
              disabled={isPending}
              onClick={() => setStep("terms")}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:border-gray-400"
            >
              Back
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={handleAppliancesStepNext}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Next: review
            </button>
          </div>
        </div>
      )}

      {step === "review" && agreementId && (
        <div className="mt-4 space-y-4 rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="font-medium text-gray-900">Review</h2>
          <p className="text-sm text-gray-600">
            {customerName} —{" "}
            {termFields.termMonths
              ? `${termFields.termMonths}-month term`
              : "Month-to-month"}
          </p>
          <ul className="divide-y divide-gray-100 text-sm">
            {addedLines.map((l) => (
              <li key={l.id} className="py-2">
                <p className="font-medium text-gray-900">
                  {l.label} — {formatCents(l.monthlyPriceCents)}/mo
                </p>
                <p className="text-gray-600">{l.applianceNames}</p>
              </li>
            ))}
          </ul>
          <p className="font-medium text-gray-900">
            Total: {formatCents(monthlyTotal)}/mo
          </p>

          {!sent ? (
            <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-4">
              <button
                type="button"
                disabled={isPending}
                onClick={() => setStep("appliances")}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:border-gray-400"
              >
                Back
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={handleSend}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {isPending ? "Sending…" : "Send for signature"}
              </button>
              <Link
                href={`/desk/agreements/${agreementId}`}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:border-gray-400"
              >
                Finish this later
              </Link>
            </div>
          ) : (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-900">
              <p className="font-medium">Sent for signature.</p>
              <p className="mt-1">
                <Link
                  href={`/desk/agreements/${agreementId}`}
                  className="underline"
                >
                  Open this agreement
                </Link>{" "}
                to get the signing link to send the customer.
              </p>
            </div>
          )}
        </div>
      )}

      {(step === "appliances" || step === "review") && !agreementId && (
        <p className="mt-4 text-sm text-red-700">
          Something went wrong creating the draft agreement — go back and try
          again.
        </p>
      )}
    </div>
  );
}
