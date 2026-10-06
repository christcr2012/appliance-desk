"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Textarea } from "@/components/ui";
import {
  createSupplierAction,
  updateSupplierAction,
} from "../purchasing-actions";

type SupplierFormValues = {
  name: string;
  contactName: string;
  phone: string;
  email: string;
  notes: string;
};

export function SupplierForm({
  supplierId,
  initial,
  onSaved,
}: {
  supplierId?: string;
  initial?: Partial<SupplierFormValues>;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [values, setValues] = useState<SupplierFormValues>({
    name: initial?.name ?? "",
    contactName: initial?.contactName ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    notes: initial?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = supplierId
        ? await updateSupplierAction(supplierId, values)
        : await createSupplierAction(values);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      if (onSaved) {
        onSaved();
      } else if (result.status === "success" && result.id) {
        router.push(`/desk/suppliers/${result.id}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field
        id="supplier-name"
        label="Supplier name"
        required
        value={values.name}
        onChange={(event) =>
          setValues({ ...values, name: event.target.value })
        }
      />

      <Field
        id="supplier-contact-name"
        label="Contact name"
        value={values.contactName}
        onChange={(event) =>
          setValues({ ...values, contactName: event.target.value })
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          id="supplier-phone"
          label="Phone"
          type="tel"
          value={values.phone}
          onChange={(event) =>
            setValues({ ...values, phone: event.target.value })
          }
        />
        <Field
          id="supplier-email"
          label="Email"
          type="email"
          value={values.email}
          onChange={(event) =>
            setValues({ ...values, email: event.target.value })
          }
        />
      </div>

      <Textarea
        id="supplier-notes"
        label="Notes"
        rows={3}
        value={values.notes}
        onChange={(event) =>
          setValues({ ...values, notes: event.target.value })
        }
      />

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : supplierId ? "Save changes" : "Add supplier"}
      </Button>

      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
