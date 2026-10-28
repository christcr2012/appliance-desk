// AR-12: label background work without saying the work was already completed.
import { Icon } from "./icons";

export function automationText(text: string): string {
  const clean = text.trim();
  return clean.startsWith("Automatic: ") ? clean : `Automatic: ${clean}`;
}

export function AutomationLine({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-1.5 text-sm text-ink-soft">
      <Icon name="gear" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{automationText(text)}</span>
    </p>
  );
}
