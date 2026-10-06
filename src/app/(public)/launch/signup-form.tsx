"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Card, Checkbox, Field, Select } from "@/components/ui";
import { submitLaunchSignup } from "./actions";
import { LAUNCH_CONSENT, type LaunchFormState } from "@/domains/launch/schema";

const initial: LaunchFormState = { status: "idle" };

export function SignupForm({ source }: { source: string }) {
  const [state, action, pending] = useActionState(submitLaunchSignup, initial);
  function error(name: string) {
    return state.errors?.[name]?.[0];
  }

  if (state.status === "success") {
    return (
      <div role="status">
        <Card>
          <p className="font-semibold text-ink">{state.message}</p>
        </Card>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="source" value={source} />
      <div aria-hidden="true" className="sr-only">
        <label htmlFor="launch-website">Website</label>
        <input
          id="launch-website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <Field
        id="launch-name"
        name="name"
        label="Name"
        type="text"
        autoComplete="name"
        maxLength={100}
        required
        error={error("name")}
      />
      <Field
        id="launch-email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        maxLength={254}
        required
        error={error("email")}
      />
      <Field
        id="launch-city"
        name="city"
        label="City"
        type="text"
        autoComplete="address-level2"
        maxLength={100}
        required
        error={error("city")}
      />
      <Select
        id="launch-interest"
        name="interest"
        label="What are you interested in?"
        defaultValue="Washer and dryer"
        error={error("interest")}
      >
        {[
          "Washer and dryer",
          "Washer",
          "Dryer",
          "Multiple properties",
          "Still deciding",
        ].map((value) => (
          <option key={value}>{value}</option>
        ))}
      </Select>
      <Checkbox
        id="launch-consent"
        name="consent"
        label={LAUNCH_CONSENT}
        required
        error={error("consent")}
      />

      <p className="text-sm text-ink-soft">
        Read our{" "}
        <Link href="/privacy" className="underline hover:text-primary">
          privacy policy
        </Link>
        . No payment, rental commitment, or phone number required.
      </p>
      {state.status === "error" && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {state.message}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Join the interest list"}
      </Button>
    </form>
  );
}
