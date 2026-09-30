"use client";

import Link from "next/link";
import { useActionState } from "react";
import { submitLaunchSignup } from "./actions";
import { LAUNCH_CONSENT, type LaunchFormState } from "@/domains/launch/schema";

const initial: LaunchFormState = { status: "idle" };
const inputClass =
  "mt-2 w-full rounded-lg border border-line bg-surface px-3 py-3 text-ink";

export function SignupForm({ source }: { source: string }) {
  const [state, action, pending] = useActionState(submitLaunchSignup, initial);
  function error(name: string) {
    return state.errors?.[name]?.[0];
  }
  if (state.status === "success")
    return (
      <p
        role="status"
        className="rounded-xl border border-line bg-primary-soft p-6 text-primary-dark"
      >
        {state.message}
      </p>
    );
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="source" value={source} />
      <div aria-hidden="true" className="hidden">
        <label htmlFor="launch-website">Website</label>
        <input
          id="launch-website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>
      {[
        {
          name: "name",
          label: "Name",
          type: "text",
          autoComplete: "name",
          maxLength: 100,
        },
        {
          name: "email",
          label: "Email",
          type: "email",
          autoComplete: "email",
          maxLength: 254,
        },
        {
          name: "city",
          label: "City",
          type: "text",
          autoComplete: "address-level2",
          maxLength: 100,
        },
      ].map((field) => (
        <div key={field.name}>
          <label htmlFor={`launch-${field.name}`} className="font-medium">
            {field.label}
          </label>
          <input
            {...field}
            id={`launch-${field.name}`}
            required
            className={inputClass}
            aria-invalid={Boolean(error(field.name))}
            aria-describedby={
              error(field.name) ? `${field.name}-error` : undefined
            }
          />
          {error(field.name) && (
            <p id={`${field.name}-error`} role="alert" className="mt-1 text-sm">
              {error(field.name)}
            </p>
          )}
        </div>
      ))}
      <div>
        <label htmlFor="launch-interest" className="font-medium">
          What are you interested in?
        </label>
        <select
          id="launch-interest"
          name="interest"
          className={inputClass}
          defaultValue="Washer and dryer"
          aria-invalid={Boolean(error("interest"))}
          aria-describedby={error("interest") ? "interest-error" : undefined}
        >
          {[
            "Washer and dryer",
            "Washer",
            "Dryer",
            "Multiple properties",
            "Still deciding",
          ].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        {error("interest") && (
          <p id="interest-error" role="alert">
            {error("interest")}
          </p>
        )}
      </div>
      <div>
        <label
          className="flex items-start gap-3 text-sm"
          htmlFor="launch-consent"
        >
          <input
            id="launch-consent"
            name="consent"
            type="checkbox"
            required
            className="mt-1 h-4 w-4 shrink-0"
            aria-invalid={Boolean(error("consent"))}
            aria-describedby={error("consent") ? "consent-error" : undefined}
          />
          <span>{LAUNCH_CONSENT}</span>
        </label>
        {error("consent") && (
          <p id="consent-error" role="alert">
            {error("consent")}
          </p>
        )}
      </div>
      <p className="text-sm text-ink-soft">
        Read our{" "}
        <Link href="/privacy" className="underline">
          privacy policy
        </Link>
        . No payment, rental commitment, or phone number required.
      </p>
      {state.status === "error" && <p role="alert">{state.message}</p>}
      <button
        disabled={pending}
        className="rounded-full bg-primary px-6 py-3 font-semibold text-on-primary disabled:opacity-60"
      >
        {pending ? "Saving…" : "Join the interest list"}
      </button>
    </form>
  );
}
