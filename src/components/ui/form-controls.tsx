"use client";

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

function HelpAndError({
  id,
  help,
  error,
}: {
  id: string;
  help?: string;
  error?: string;
}) {
  return (
    <>
      {help && (
        <p id={`${id}-help`} className="mt-1 text-xs text-ink-soft">
          {help}
        </p>
      )}
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className="mt-1 text-xs font-semibold text-danger"
        >
          {error}
        </p>
      )}
    </>
  );
}

function describedBy(id: string, help?: string, error?: string) {
  return [help ? `${id}-help` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ") || undefined;
}

export const Field = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & {
    label: string;
    help?: string;
    error?: string;
  }
>(function Field(
  { label, help, error, id: explicitId, className = "", ...props },
  ref,
) {
  const generatedId = useId();
  const id = explicitId ?? generatedId;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      <input
        {...props}
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, help, error)}
        className={`mt-2 min-h-11 w-full rounded-control border border-control bg-surface px-3 py-2 text-ink ${className}`}
      />
      <HelpAndError id={id} help={help} error={error} />
    </div>
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & {
    label: string;
    help?: string;
    error?: string;
  }
>(function Select(
  {
    label,
    help,
    error,
    id: explicitId,
    className = "",
    children,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const id = explicitId ?? generatedId;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      <select
        {...props}
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, help, error)}
        className={`mt-2 min-h-11 w-full rounded-control border border-control bg-surface px-3 py-2 text-ink ${className}`}
      >
        {children}
      </select>
      <HelpAndError id={id} help={help} error={error} />
    </div>
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & {
    label: string;
    help?: string;
    error?: string;
  }
>(function Textarea(
  { label, help, error, id: explicitId, className = "", ...props },
  ref,
) {
  const generatedId = useId();
  const id = explicitId ?? generatedId;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      <textarea
        {...props}
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, help, error)}
        className={`mt-2 min-h-24 w-full rounded-control border border-control bg-surface px-3 py-2 text-ink ${className}`}
      />
      <HelpAndError id={id} help={help} error={error} />
    </div>
  );
});

export const Checkbox = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
    label: string;
    help?: string;
    error?: string;
  }
>(function Checkbox(
  { label, help, error, id: explicitId, className = "", ...props },
  ref,
) {
  const generatedId = useId();
  const id = explicitId ?? generatedId;

  return (
    <div>
      <label
        htmlFor={id}
        className="flex min-h-11 items-center gap-3 text-sm font-semibold text-ink"
      >
        <input
          {...props}
          ref={ref}
          id={id}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, help, error)}
          className={`h-5 w-5 rounded-control border border-control bg-surface ${className}`}
        />
        <span>{label}</span>
      </label>
      <HelpAndError id={id} help={help} error={error} />
    </div>
  );
});
