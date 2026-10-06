"use client";

import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { SupplierForm } from "../supplier-form";

export function SupplierDetailClient({
  supplierId,
  initial,
}: {
  supplierId: string;
  initial: {
    name: string;
    contactName: string;
    phone: string;
    email: string;
    notes: string;
  };
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <Card
        title="Edit supplier"
        actions={
          <Button
            type="button"
            variant="quiet"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        }
      >
        <SupplierForm
          supplierId={supplierId}
          initial={initial}
          onSaved={() => setEditing(false)}
        />
      </Card>
    );
  }

  return (
    <Card
      title="Supplier details"
      actions={
        <Button
          type="button"
          variant="secondary"
          onClick={() => setEditing(true)}
        >
          Edit
        </Button>
      }
    >
      <div className="space-y-1 text-sm text-ink-soft">
        {initial.contactName && <p>{initial.contactName}</p>}
        {initial.phone && <p>{initial.phone}</p>}
        {initial.email && <p>{initial.email}</p>}
        {initial.notes && <p className="pt-2">{initial.notes}</p>}
      </div>
    </Card>
  );
}
