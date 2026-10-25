"use client";

import { useActionState } from "react";
import type { FamilySetting } from "@/domains/messaging/workflow-text-settings";
import { WORKFLOW_TEXT_GROUP_LABELS } from "@/domains/messaging/workflow-text-catalog";
import { approveWordingAction, confirmLegalReviewAction, saveQuietHoursAction, setTextEnabledAction, type TextActionState } from "./actions";

const allGroups = Object.entries(WORKFLOW_TEXT_GROUP_LABELS);
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function FamilyRow({ f, version }: { f: FamilySetting; version: number }) {
  const [wordState, approve, approving] = useActionState<TextActionState, FormData>(approveWordingAction, null);
  const [reviewState, review, reviewing] = useActionState<TextActionState, FormData>(confirmLegalReviewAction, null);
  const [switchState, toggle, toggling] = useActionState<TextActionState, FormData>(setTextEnabledAction, null);
  return <li className="rounded border border-line p-3">
    <h4 className="font-semibold">{f.label} · {f.enabled ? "On" : "Off"}</h4>
    <p className="text-sm text-ink-soft">{f.when}</p>
    <form action={approve} className="mt-2 space-y-1">
      <input type="hidden" name="family" value={f.key} />
      <label className="block text-sm font-medium" htmlFor={`w-${f.key}`}>Wording {f.approved ? "(approved)" : "(not approved yet)"}</label>
      <textarea id={`w-${f.key}`} name="body" defaultValue={f.wording} rows={3} className="w-full rounded border border-line p-2 text-sm" />
      <p className="text-xs text-ink-soft">Words in double curly brackets are filled in for each person. Example: {f.sample} ({f.sampleParts} text part{f.sampleParts === 1 ? "" : "s"}).
        Keep the business name and “Reply STOP to opt out.”</p>
      <button disabled={approving} className="rounded border border-line px-3 py-1 text-sm">{f.approved ? "Approve this wording" : "Approve starting wording"}</button>
      {wordState && <p role="status" className="text-sm">{wordState.message}</p>}
    </form>
    {f.needsLegalReview && <form action={review} className="mt-2 rounded border border-line p-2">
      <p className="text-sm"><strong>Needs a professional&apos;s review.</strong> {f.legalReason} This text cannot be switched on until you confirm
        that a lawyer or other qualified person has read these exact words. Changing the wording removes the confirmation.</p>
      <input type="hidden" name="family" value={f.key} /><input type="hidden" name="version" value={version} />
      <input type="hidden" name="reviewed" value={f.legalReviewed ? "no" : "yes"} />
      <button disabled={reviewing || (!f.approved && !f.legalReviewed)} className="mt-1 rounded border border-line px-3 py-1 text-sm">
        {f.legalReviewed ? "Remove review confirmation" : "Confirm a professional has read this wording"}</button>
      <span className="ml-2 text-sm">{f.legalReviewed ? "Confirmed." : "Not confirmed."}</span>
      {reviewState && <p role="status" className="text-sm">{reviewState.message}</p>}
    </form>}
    <form action={toggle} className="mt-2">
      <input type="hidden" name="family" value={f.key} /><input type="hidden" name="version" value={version} />
      <input type="hidden" name="enabled" value={f.enabled ? "no" : "yes"} />
      <button disabled={toggling || (!f.enabled && (!f.approved || (f.needsLegalReview && !f.legalReviewed)))} className="rounded border border-line px-3 py-1 text-sm">
        {f.enabled ? "Switch this text off" : "Switch this text on"}</button>
      {!f.approved && !f.enabled && <span className="ml-2 text-xs">Approve the wording first.</span>}
      {switchState && <p role="status" className="text-sm">{switchState.message}</p>}
    </form>
  </li>;
}

export function WorkflowTextsSettings({ families, version, quietHours, isRecommended, policyReady }: {
  families: FamilySetting[]; version: number; quietHours: { startMinute: number; endMinute: number }; isRecommended: boolean; policyReady: boolean;
}) {
  const groups = allGroups.filter(([g]) => families.some((f) => f.group === g));
  const [quietState, saveQuiet, savingQuiet] = useActionState<TextActionState, FormData>(saveQuietHoursAction, null);
  return <div className="space-y-4">
    {!policyReady && <p className="text-sm">Finish the phone setup above before switching individual texts on.</p>}
    <form action={saveQuiet} className="rounded border border-line p-3">
      <h4 className="font-semibold">Quiet hours</h4>
      <p className="text-sm text-ink-soft">No automatic-style texts go out between these times (Colorado time). Starting value: 9:00 pm to 8:00 am, so nobody is texted at night. {isRecommended ? "You are using the starting value." : ""}</p>
      <input type="hidden" name="version" value={version} />
      <label className="mr-3 text-sm">From <input type="time" name="start" defaultValue={hhmm(quietHours.startMinute)} className="rounded border border-line p-1" /></label>
      <label className="text-sm">Until <input type="time" name="end" defaultValue={hhmm(quietHours.endMinute)} className="rounded border border-line p-1" /></label>
      <div className="mt-2 flex gap-2">
        <button disabled={savingQuiet || !policyReady} className="rounded border border-line px-3 py-1 text-sm">Save quiet hours</button>
        <button disabled={savingQuiet || !policyReady} name="restore" value="yes" className="rounded border border-line px-3 py-1 text-sm">Restore recommended</button>
      </div>
      {quietState && <p role="status" className="text-sm">{quietState.message}</p>}
    </form>
    {groups.map(([group, label]) => <div key={group}>
      <h3 className="mb-2 mt-2 font-semibold">{label}</h3>
      <ul className="space-y-3">{families.filter((f) => f.group === group).map((f) => <FamilyRow key={f.key} f={f} version={version} />)}</ul>
    </div>)}
  </div>;
}
