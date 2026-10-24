"use client";

import { useState, useTransition } from "react";
import { Button, Checkbox, Field, Select, StatusPill } from "@/components/ui";
import { CAPABILITIES, CAPABILITY_KEYS } from "@/domains/capabilities/labels";
import { SCREENS, SCREEN_KEYS } from "@/domains/team/job-role-rules";
import {
  archiveJobRoleAction, restoreJobRoleAction, restoreStarterJobRoleAction, saveJobRoleAction, type TeamActionState,
} from "./team-actions";

export type JobRoleView = {
  id: string; label: string; accessLevel: "STAFF" | "ADMIN"; screens: string[]; capabilityLimits: string[];
  isStarter: boolean; archived: boolean; people: number;
};

type Msg = { kind: "success" | "error"; text: string };
type Draft = { id: string | null; label: string; accessLevel: "STAFF" | "ADMIN"; screens: string[]; capabilityLimits: string[] };
const EMPTY: Draft = { id: null, label: "", accessLevel: "STAFF", screens: [], capabilityLimits: [] };

export function JobRolesEditor({ jobRoles }: { jobRoles: JobRoleView[] }) {
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);

  function show(r: TeamActionState): Msg {
    return r.status === "error" ? { kind: "error", text: r.message } : { kind: "success", text: r.message };
  }
  function run(fn: () => Promise<TeamActionState>, after?: () => void) {
    start(async () => { const r = await fn(); setMsg(show(r)); if (r.status === "success") after?.(); });
  }

  // Staff can never be given money or settings screens (waits for the owner's answer to IN-13), so those boxes are off for staff roles.
  const staffDraft = draft?.accessLevel === "STAFF";

  return (
    <section aria-labelledby="job-roles" className="space-y-4 border-t border-line pt-6">
      <h3 id="job-roles" className="font-semibold text-ink">Job roles</h3>
      <p className="max-w-2xl text-sm text-ink-soft">
        A job role is a list of screens on top of someone&apos;s access level. It can only take screens away, never add power:
        staff stay without money screens and admins stay admins. People with no job role see everything their access level allows.
        Changing a job role signs the person out so it shows at once.
      </p>
      <ul className="divide-y divide-line">
        {jobRoles.map((role) => (
          <li key={role.id} className="space-y-2 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">{role.label}</span>
              <StatusPill tone="progress" label={role.accessLevel === "ADMIN" ? "Admin" : "Staff"} />
              {role.archived && <StatusPill tone="stopped" label="Archived" />}
              <span className="text-sm text-ink-soft">{role.people === 1 ? "1 person" : `${role.people} people`}</span>
            </div>
            <p className="text-sm text-ink-soft">
              {role.screens.length > 0 ? role.screens.map((s) => SCREENS[s as keyof typeof SCREENS]?.label ?? s).join(", ") : "No extra screens (Today and My account only)."}
              {role.capabilityLimits.length > 0 && ` Switched off: ${role.capabilityLimits.map((c) => CAPABILITIES[c as keyof typeof CAPABILITIES]?.label ?? c).join(", ")}.`}
            </p>
            <div className="flex flex-wrap gap-2">
              {!role.archived && <Button type="button" variant="secondary" disabled={pending} onClick={() => { setMsg(null); setDraft({ id: role.id, label: role.label, accessLevel: role.accessLevel, screens: role.screens, capabilityLimits: role.capabilityLimits }); }}>Edit</Button>}
              {role.isStarter && !role.archived && <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => restoreStarterJobRoleAction(role.id))}>Restore recommended</Button>}
              {!role.archived && <Button type="button" variant="danger" disabled={pending} onClick={() => run(() => archiveJobRoleAction(role.id))}>Archive</Button>}
              {role.archived && <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => restoreJobRoleAction(role.id))}>Restore</Button>}
            </div>
          </li>
        ))}
      </ul>

      {draft ? (
        <form
          className="max-w-md space-y-4 rounded border border-line p-4"
          onSubmit={(e) => { e.preventDefault(); run(() => saveJobRoleAction({ ...draft, id: draft.id ?? undefined }), () => setDraft(null)); }}
        >
          <h4 className="font-semibold text-ink">{draft.id ? "Edit job role" : "New job role"}</h4>
          <Field id="jobRoleLabel" label="Name" type="text" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          <Select id="jobRoleLevel" label="Access level" value={draft.accessLevel}
            onChange={(e) => {
              const next = e.target.value === "ADMIN" ? "ADMIN" : "STAFF";
              setDraft({ ...draft, accessLevel: next, screens: next === "STAFF" ? draft.screens.filter((s) => !SCREENS[s as keyof typeof SCREENS].money) : draft.screens, capabilityLimits: next === "STAFF" ? [] : draft.capabilityLimits });
            }}>
            <option value="STAFF">Staff</option>
            <option value="ADMIN">Admin</option>
          </Select>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-ink">Screens this job role can open</legend>
            {SCREEN_KEYS.map((key) => {
              const locked = staffDraft && SCREENS[key].money;
              return (
                <Checkbox key={key} label={SCREENS[key].label} help={locked ? "Staff cannot be given money or settings screens." : undefined}
                  checked={draft.screens.includes(key)} disabled={locked}
                  onChange={(e) => setDraft({ ...draft, screens: e.target.checked ? [...draft.screens, key] : draft.screens.filter((s) => s !== key) })} />
              );
            })}
          </fieldset>
          {draft.accessLevel === "ADMIN" && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-ink">Admin permissions switched off for this job role</legend>
              {CAPABILITY_KEYS.map((key) => (
                <Checkbox key={key} label={CAPABILITIES[key].label} help={CAPABILITIES[key].help}
                  checked={draft.capabilityLimits.includes(key)}
                  onChange={(e) => setDraft({ ...draft, capabilityLimits: e.target.checked ? [...draft.capabilityLimits, key] : draft.capabilityLimits.filter((c) => c !== key) })} />
              ))}
            </fieldset>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending || !draft.label.trim()}>{pending ? "Saving…" : "Save job role"}</Button>
            <Button type="button" variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="secondary" onClick={() => { setMsg(null); setDraft({ ...EMPTY }); }}>New job role</Button>
      )}
      {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={`text-sm font-medium ${msg.kind === "error" ? "text-danger" : "text-success"}`}>{msg.text}</p>}
    </section>
  );
}
