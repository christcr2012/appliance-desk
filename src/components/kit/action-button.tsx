"use client";
// AR-0 kit 4.13: one button for every ActionSpec kind. Form actions show their pending label and are disabled while
// they run (KIT 6.1); a confirm spec opens the plain ConfirmDialog first and is never optimistic.
import Link from "next/link";
import { useRef, useState, type ReactNode, type RefObject } from "react";
import { useFormStatus } from "react-dom";
import { ConfirmDialog } from "./confirm-dialog";
import { useDeskOffline } from "./offline-bar";
import { Icon, type IconName } from "./icons";
import { fieldsToFormData, runFormAction } from "./run-action";
import { assertActionSpec, type ActionSpec } from "./types";

export type ActionButtonProps = {
  spec: ActionSpec;
  size?: "md" | "lg";
  variant?: "primary" | "secondary";
  /** Layout classes from a kit container (width, flex). */
  className?: string;
  /** Show only this icon; the spec's label becomes the accessible name. */
  iconOnly?: IconName;
  /** Icon shown before the label. */
  icon?: IconName;
};

// actionButtonClass lives in ./action-button-class (server-safe) and is
// re-exported here for existing importers of this module.
export { actionButtonClass } from "./action-button-class";
import { actionButtonClass } from "./action-button-class";

function Content({ label, icon, iconOnly }: { label: ReactNode; icon?: IconName; iconOnly?: IconName }) {
  if (iconOnly) return <Icon name={iconOnly} size={24} />;
  return (
    <>
      {icon ? <Icon name={icon} /> : null}
      <span>{label}</span>
    </>
  );
}

function SubmitButton({
  spec,
  className,
  icon,
  iconOnly,
  onConfirmFirst,
  buttonRef,
}: {
  spec: Extract<ActionSpec, { kind: "form" }>;
  className: string;
  icon?: IconName;
  iconOnly?: IconName;
  onConfirmFirst?: () => void;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const { pending } = useFormStatus();
  const offline = useDeskOffline();
  const label = pending ? (spec.pendingLabel ?? "Saving…") : spec.label;
  return (
    <button
      ref={buttonRef}
      type="submit"
      disabled={pending || offline}
      aria-disabled={pending || offline || undefined}
      title={offline ? "You're offline" : undefined}
      aria-label={iconOnly ? label : undefined}
      className={className}
      onClick={
        onConfirmFirst
          ? (event) => {
              event.preventDefault();
              onConfirmFirst();
            }
          : undefined
      }
    >
      <Content label={label} icon={icon} iconOnly={iconOnly} />
    </button>
  );
}

function FormActionButton(props: ActionButtonProps & { spec: Extract<ActionSpec, { kind: "form" }> }) {
  const { spec, icon, iconOnly } = props;
  const formRef = useRef<HTMLFormElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  return (
    <form
      ref={formRef}
      className="contents"
      action={async (data: FormData) => {
        // Never send a write while offline, even if a caller submits the form programmatically.
        if (typeof navigator !== "undefined" && !navigator.onLine) return;
        await runFormAction(spec, fieldsToFormData(spec.fields, data));
      }}
    >
      {Object.entries(spec.fields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton
        spec={spec}
        className={actionButtonClass(props)}
        icon={icon}
        iconOnly={iconOnly}
        onConfirmFirst={spec.confirm ? () => setConfirming(true) : undefined}
        buttonRef={buttonRef}
      />
      {spec.confirm ? (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          spec={spec.confirm}
          onConfirm={() => formRef.current?.requestSubmit()}
          returnFocusRef={buttonRef}
        />
      ) : null}
    </form>
  );
}

export function ActionButton(props: ActionButtonProps) {
  const { spec, icon, iconOnly } = props;
  assertActionSpec(spec);
  const className = actionButtonClass(props);
  const ariaLabel = iconOnly ? spec.label : undefined;
  switch (spec.kind) {
    case "link":
      return (
        <Link href={spec.href} className={className} aria-label={ariaLabel}>
          <Content label={spec.label} icon={icon} iconOnly={iconOnly} />
        </Link>
      );
    case "tel":
      return (
        <a href={`tel:${spec.phone.replace(/[^\d+]/g, "")}`} className={className} aria-label={ariaLabel}>
          <Content label={spec.label} icon={icon} iconOnly={iconOnly} />
        </a>
      );
    case "mailto":
      return (
        <a href={`mailto:${spec.email}`} className={className} aria-label={ariaLabel}>
          <Content label={spec.label} icon={icon} iconOnly={iconOnly} />
        </a>
      );
    case "form":
      return <FormActionButton {...props} spec={spec} />;
  }
}
