"use client";

import { useState, useTransition } from "react";
import { Button, Checkbox, DataList, EmptyState, Field, Select, StatusPill, type DataListColumn } from "@/components/ui";
import { CAPABILITIES, CAPABILITY_KEYS } from "@/domains/capabilities/labels";
import {
  assignJobRoleAction, cancelInvitationAction, changeAccessLevelAction, inviteTeamMemberAction, removeTeamMemberAction,
  resendInvitationAction, resetTeamSignInAction, restoreTeamMemberAction, saveTeamSettingsAction, type TeamActionState,
} from "./team-actions";
import { signOutStaffEverywhereAction } from "./actions";
import { JobRolesEditor, type JobRoleView } from "./job-roles-editor";

export type TeamMember = { id: string; name: string; email: string; accessLevel: string; active: boolean; twoStepOn: boolean; lastSignIn: string | null; jobRoleId: string | null };
export type TeamInvitation = { id: string; name: string; email: string; accessLevel: string; state: string; expiresAt: string };

const LEVEL_LABEL: Record<string, string> = { OWNER: "Owner", ADMIN: "Admin", STAFF: "Staff" };
type Msg = { kind: "success" | "error"; text: string };

function formatWhen(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Denver", dateStyle: "medium", timeStyle: "short" });
}

export function TeamSection({
  members, invitations, viewerRole, viewerId, settings, jobRoles,
}: {
  members: TeamMember[]; invitations: TeamInvitation[]; viewerRole: "OWNER" | "ADMIN"; viewerId: string;
  settings: { invitationLinkDays: number; adminsMayInviteStaff: boolean };
  jobRoles: JobRoleView[];
}) {
  const activeRoles = jobRoles.filter((r) => !r.archived);
  const isOwner = viewerRole === "OWNER";
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [level, setLevel] = useState("STAFF");
  const [jobRoleId, setJobRoleId] = useState("");
  const [blocked, setBlocked] = useState<string[]>([]);
  const [formMsg, setFormMsg] = useState<Msg | null>(null);
  const [rowMsg, setRowMsg] = useState<Record<string, Msg>>({});
  const [promoting, setPromoting] = useState<string | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  const [days, setDays] = useState(String(settings.invitationLinkDays));
  const [adminsInvite, setAdminsInvite] = useState(settings.adminsMayInviteStaff);
  const [settingsMsg, setSettingsMsg] = useState<Msg | null>(null);

  function show(result: TeamActionState): Msg {
    if (result.status === "error") return { kind: "error", text: result.message };
    return { kind: result.warning ? "error" : "success", text: result.warning ? `${result.message} ${result.warning}` : result.message };
  }
  function rowAction(id: string, fn: () => Promise<TeamActionState>) {
    start(async () => { const r = await fn(); setRowMsg((c) => ({ ...c, [id]: show(r) })); if (r.status === "success") setPromoting(null); });
  }

  function submitInvite(event: React.FormEvent) {
    event.preventDefault();
    setFormMsg(null);
    start(async () => {
      const r = await inviteTeamMemberAction({ name, email, phone, accessLevel: level, adminCapabilityLimits: level === "ADMIN" ? blocked : [], jobRoleId: jobRoleId || undefined });
      setFormMsg(show(r));
      if (r.status === "success") { setName(""); setEmail(""); setPhone(""); setBlocked([]); setJobRoleId(""); }
    });
  }

  function submitSettings(event: React.FormEvent) {
    event.preventDefault();
    start(async () => setSettingsMsg(show(await saveTeamSettingsAction({ invitationLinkDays: Number(days), adminsMayInviteStaff: adminsInvite }))));
  }

  const memberColumns: DataListColumn<TeamMember>[] = [
    { key: "name", header: "Name", primary: true, cell: (m) => m.name },
    { key: "email", header: "Email", cell: (m) => m.email },
    { key: "level", header: "Access level", cell: (m) => LEVEL_LABEL[m.accessLevel] ?? m.accessLevel },
    {
      key: "jobrole", header: "Job role",
      cell: (m) => {
        const current = jobRoles.find((r) => r.id === m.jobRoleId);
        if (m.accessLevel === "OWNER") return "Everything";
        if (!isOwner || !m.active) return current ? current.label : "None (access level only)";
        const options = activeRoles.filter((r) => r.accessLevel === m.accessLevel);
        return (
          <Select id={`jobRole-${m.id}`} label={`Job role for ${m.name}`} value={m.jobRoleId ?? ""} disabled={pending}
            onChange={(e) => rowAction(m.id, () => assignJobRoleAction(m.id, e.target.value))}>
            <option value="">None (access level only)</option>
            {options.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </Select>
        );
      },
    },
    { key: "twostep", header: "Two-step", cell: (m) => (m.twoStepOn ? "On" : "Off") },
    { key: "last", header: "Last signed in", cell: (m) => formatWhen(m.lastSignIn) },
    { key: "status", header: "Status", cell: (m) => <StatusPill tone={m.active ? "success" : "stopped"} label={m.active ? "Active" : "Removed"} /> },
    {
      key: "actions", header: "Actions",
      cell: (m) => {
        const self = m.id === viewerId;
        const canTouch = !self && m.accessLevel !== "OWNER" && (isOwner || m.accessLevel === "STAFF");
        return (
          <div>
            <div className="flex flex-wrap gap-2">
              {canTouch && m.active && <Button type="button" variant="danger" disabled={pending} onClick={() => rowAction(m.id, () => removeTeamMemberAction(m.id))}>Remove access</Button>}
              {canTouch && !m.active && <Button type="button" variant="secondary" disabled={pending} onClick={() => rowAction(m.id, () => restoreTeamMemberAction(m.id))}>Restore access</Button>}
              {isOwner && !self && m.active && m.accessLevel === "STAFF" && <Button type="button" variant="secondary" disabled={pending} onClick={() => { setPromoting(m.id); setTicked([]); }}>Make admin</Button>}
              {isOwner && !self && m.active && m.accessLevel === "ADMIN" && <Button type="button" variant="secondary" disabled={pending} onClick={() => rowAction(m.id, () => changeAccessLevelAction(m.id, "STAFF", []))}>Make staff</Button>}
              {isOwner && !self && m.active && m.accessLevel !== "OWNER" && (
                <Button type="button" variant="secondary" disabled={pending} onClick={() => {
                  if (window.confirm(`Reset ${m.name}'s sign-in? They are signed out everywhere, their second step is turned off, and they get an email link to choose a new password.`)) rowAction(m.id, () => resetTeamSignInAction(m.id));
                }}>Reset sign-in</Button>
              )}
              {isOwner && !self && m.active && m.accessLevel !== "OWNER" && (
                <Button type="button" variant="secondary" disabled={pending} onClick={() => rowAction(m.id, async () => {
                  const r = await signOutStaffEverywhereAction(m.id);
                  return r.status === "error" ? { status: "error", message: r.message } : { status: "success", message: "Signed out everywhere." };
                })}>Sign out everywhere</Button>
              )}
            </div>
            {promoting === m.id && (
              <fieldset className="mt-3 space-y-2 rounded border border-line p-3">
                <legend className="px-1 text-sm font-semibold text-ink">Tick what this admin may do (everything else stays off)</legend>
                {CAPABILITY_KEYS.map((key) => (
                  <Checkbox key={key} label={CAPABILITIES[key].label} help={CAPABILITIES[key].help} checked={ticked.includes(key)}
                    onChange={(e) => setTicked((c) => (e.target.checked ? [...c, key] : c.filter((x) => x !== key)))} />
                ))}
                <div className="flex gap-2">
                  <Button type="button" disabled={pending} onClick={() => rowAction(m.id, () => changeAccessLevelAction(m.id, "ADMIN", ticked))}>Make {m.name} an admin</Button>
                  <Button type="button" variant="secondary" onClick={() => setPromoting(null)}>Cancel</Button>
                </div>
              </fieldset>
            )}
            {rowMsg[m.id] && <p role={rowMsg[m.id].kind === "error" ? "alert" : "status"} className={`mt-2 text-sm font-medium ${rowMsg[m.id].kind === "error" ? "text-danger" : "text-success"}`}>{rowMsg[m.id].text}</p>}
          </div>
        );
      },
    },
  ];

  const inviteColumns: DataListColumn<TeamInvitation>[] = [
    { key: "name", header: "Name", primary: true, cell: (i) => i.name },
    { key: "email", header: "Email", cell: (i) => i.email },
    { key: "level", header: "Access level", cell: (i) => LEVEL_LABEL[i.accessLevel] ?? i.accessLevel },
    { key: "state", header: "Status", cell: (i) => <StatusPill tone={i.state === "INVITED" ? "progress" : "stopped"} label={i.state === "INVITED" ? `Invited · link works until ${formatWhen(i.expiresAt)}` : i.state === "EXPIRED" ? "Expired" : "Cancelled"} /> },
    {
      key: "actions", header: "Actions",
      cell: (i) => {
        const canManage = isOwner || (i.accessLevel === "STAFF" && settings.adminsMayInviteStaff);
        return (
          <div>
            {canManage && i.state !== "CANCELLED" && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" disabled={pending} onClick={() => rowAction(i.id, () => resendInvitationAction(i.id))}>Send again</Button>
                <Button type="button" variant="danger" disabled={pending} onClick={() => rowAction(i.id, () => cancelInvitationAction(i.id))}>Cancel invitation</Button>
              </div>
            )}
            {rowMsg[i.id] && <p role={rowMsg[i.id].kind === "error" ? "alert" : "status"} className={`mt-2 text-sm font-medium ${rowMsg[i.id].kind === "error" ? "text-danger" : "text-success"}`}>{rowMsg[i.id].text}</p>}
          </div>
        );
      },
    },
  ];

  const mayInvite = isOwner || settings.adminsMayInviteStaff;

  return (
    <div className="space-y-8">
      <p className="max-w-2xl text-sm text-ink-soft">
        Everyone who can sign in to the desk. Staff see day-to-day work but not the money side. Admins see the money side unless you switch a permission off. Only you can make someone an admin.
      </p>

      <DataList rows={members} columns={memberColumns} caption="Team members" empty={<EmptyState title="No team members yet" description="Invite someone below." />} />

      <section aria-labelledby="open-invites" className="space-y-3">
        <h3 id="open-invites" className="font-semibold text-ink">Invitations</h3>
        <DataList rows={invitations} columns={inviteColumns} caption="Invitations" empty={<EmptyState title="No open invitations" description="People you invite show up here until they set their password." />} />
      </section>

      {mayInvite ? (
        <form onSubmit={submitInvite} className="max-w-md space-y-4 border-t border-line pt-6">
          <h3 className="font-semibold text-ink">Invite a team member</h3>
          <Field id="inviteName" label="Name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
          <Field id="inviteEmail" label="Email" help="They get a link to choose their own password. You never see or choose it." type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field id="invitePhone" label="Phone (optional)" help="Used later for text sign-in codes." type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          {isOwner ? (
            <Select id="inviteLevel" label="Access level" value={level} onChange={(e) => { setLevel(e.target.value); setJobRoleId(""); }}>
              <option value="STAFF">Staff</option>
              <option value="ADMIN">Admin</option>
            </Select>
          ) : (
            <p className="text-sm text-ink-soft">Access level: Staff. Only the owner can invite an admin.</p>
          )}
          <Select id="inviteJobRole" label="Job role (optional)" value={jobRoleId} onChange={(e) => setJobRoleId(e.target.value)}>
            <option value="">None (access level only)</option>
            {activeRoles.filter((r) => r.accessLevel === level).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </Select>
          {isOwner && level === "ADMIN" && (
            <fieldset className="space-y-2 rounded border border-line p-3">
              <legend className="px-1 text-sm font-semibold text-ink">What this admin may do (untick to switch off)</legend>
              {CAPABILITY_KEYS.map((key) => (
                <Checkbox key={key} label={CAPABILITIES[key].label} help={CAPABILITIES[key].help} checked={!blocked.includes(key)}
                  onChange={(e) => setBlocked((c) => (e.target.checked ? c.filter((x) => x !== key) : [...c, key]))} />
              ))}
            </fieldset>
          )}
          <Button type="submit" disabled={pending || !name || !email}>{pending ? "Sending…" : "Send invitation"}</Button>
          {formMsg && <p role={formMsg.kind === "error" ? "alert" : "status"} className={`text-sm font-medium ${formMsg.kind === "error" ? "text-danger" : "text-success"}`}>{formMsg.text}</p>}
        </form>
      ) : (
        <p className="border-t border-line pt-6 text-sm text-ink-soft">The owner has not allowed admins to invite staff. Ask the owner to invite someone.</p>
      )}

      {isOwner && <JobRolesEditor jobRoles={jobRoles} />}

      {isOwner && (
        <form onSubmit={submitSettings} className="max-w-md space-y-4 border-t border-line pt-6">
          <h3 className="font-semibold text-ink">Invitation rules</h3>
          <Field id="linkDays" label="Days an invitation link works" help="Starting value 7. Between 1 and 30. Applies to new and re-sent links only." type="number" min={1} max={30} value={days} onChange={(e) => setDays(e.target.value)} />
          <Checkbox label="Admins may invite staff" help="Starting value off. Admins can never invite or promote another admin, whatever this says." checked={adminsInvite} onChange={(e) => setAdminsInvite(e.target.checked)} />
          <Button type="submit" disabled={pending}>Save invitation rules</Button>
          {settingsMsg && <p role={settingsMsg.kind === "error" ? "alert" : "status"} className={`text-sm font-medium ${settingsMsg.kind === "error" ? "text-danger" : "text-success"}`}>{settingsMsg.text}</p>}
        </form>
      )}
    </div>
  );
}
