// AR-11: React 19.3 native record-title morph shared by list links and the matching record header.
import { ViewTransition, type ReactNode } from "react";

export function recordTransitionName(id: string): string {
  return `record-${id}`;
}

export function RecordTitleTransition({ id, children }: { id: string; children: ReactNode }) {
  return (
    <ViewTransition name={recordTransitionName(id)} default="none" share="desk-record-title">
      {children}
    </ViewTransition>
  );
}
