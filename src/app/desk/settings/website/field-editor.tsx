"use client";

import { useId, useState } from "react";
import { Button, Checkbox, Field, Select, Textarea } from "@/components/ui";
import { ImageCropPreview } from "@/components/desk/image-crop-preview";
import type { EditorField } from "@/domains/site-content/editor-fields";
import { SITE_PAGE_PATHS } from "@/domains/site-content/links";
import { denverLocalToUtc, describePromotionSchedule, utcToDenverLocal } from "@/domains/site-content/promotions";
import { summarizeValue } from "@/domains/site-content/review";
import { draftAssetPath } from "@/domains/site-content/asset-paths";
import type { ImageValue, LinkValue, PromotionValue, SiteLinkTarget, SiteValue } from "@/domains/site-content/types";
import { ValueView } from "./value-view";

export type AssetInfo = { id: string; state: "DRAFT" | "PUBLIC"; width: number; height: number; previewPath: string };

const PAGE_NAMES: Record<string, string> = {
  "/": "Home page", "/pricing": "Pricing", "/how-it-works": "How it works", "/service-area": "Service area", "/contact": "Get a quote",
  "/launch": "Launch list", "/privacy": "Privacy policy", "/terms": "Rental terms", "/accessibility": "Accessibility",
};

const emptyLink = (): LinkValue => ({ kind: "link", label: "", target: { type: "page", path: "/" } });
const emptyImage = (): ImageValue => ({ kind: "image", assetId: "", alt: "", decorative: false, focalX: 50, focalY: 50 });

function LinkEditor({ id, value, onChange, labelText }: { id: string; value: LinkValue; onChange: (next: LinkValue) => void; labelText: string }) {
  const target = value.target;
  const setTarget = (next: SiteLinkTarget) => onChange({ ...value, target: next });
  return (
    <div className="space-y-4">
      <Field id={`${id}-label`} label={`${labelText}: words people see`} value={value.label} maxLength={80} onChange={(e) => onChange({ ...value, label: e.target.value })} />
      <Select
        id={`${id}-type`}
        label={`${labelText}: where it goes`}
        value={target.type}
        onChange={(e) => {
          const type = e.target.value;
          setTarget(type === "page" ? { type: "page", path: "/" } : type === "external" ? { type: "external", url: "https://" } : type === "phone" ? { type: "phone" } : { type: "email" });
        }}
      >
        <option value="page">A page on this website</option>
        <option value="external">Another website</option>
        <option value="phone">Calls your business phone (from Settings)</option>
        <option value="email">Emails your business address (from Settings)</option>
      </Select>
      {target.type === "page" && (
        <>
          <Select id={`${id}-page`} label="Which page" value={SITE_PAGE_PATHS.includes(target.path) ? target.path : "/"} onChange={(e) => setTarget({ type: "page", path: e.target.value, ...(target.anchor ? { anchor: target.anchor } : {}) })}>
            {SITE_PAGE_PATHS.map((path) => <option key={path} value={path}>{PAGE_NAMES[path] ?? path}</option>)}
          </Select>
          <Field id={`${id}-anchor`} label="Jump to a part of that page (optional)" help="Lowercase letters, numbers and dashes, for example: faq" value={target.anchor ?? ""} maxLength={41} onChange={(e) => setTarget({ type: "page", path: target.path, ...(e.target.value ? { anchor: e.target.value } : {}) })} />
        </>
      )}
      {target.type === "external" && (
        <Field id={`${id}-url`} label="Web address" help="Must start with https://" inputMode="url" value={target.url} maxLength={500} onChange={(e) => setTarget({ type: "external", url: e.target.value })} />
      )}
    </div>
  );
}

function ImageEditor({
  id, value, onChange, assets, onUploaded, labelText,
}: { id: string; value: ImageValue; onChange: (next: ImageValue) => void; assets: AssetInfo[]; onUploaded: (a: AssetInfo) => void; labelText: string }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true); setProblem(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/desk/website-assets", { method: "POST", body });
      const json = (await response.json().catch(() => ({}))) as { asset?: { id: string; width: number; height: number; previewPath: string }; error?: string };
      if (!response.ok || !json.asset) { setProblem(json.error ?? "The picture could not be uploaded."); return; }
      onUploaded({ id: json.asset.id, state: "DRAFT", width: json.asset.width, height: json.asset.height, previewPath: json.asset.previewPath });
      onChange({ ...value, assetId: json.asset.id });
    } catch {
      setProblem("The picture could not be uploaded. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="text-sm font-semibold text-ink">{labelText}: choose a picture</legend>
        {assets.length === 0 && <p className="mt-2 text-sm text-ink-soft">No pictures yet. Upload one below.</p>}
        <ul className="mt-2 flex flex-wrap gap-3">
          {assets.map((asset) => (
            <li key={asset.id}>
              <label className={`block cursor-pointer rounded-control border-2 p-1 ${value.assetId === asset.id ? "border-action" : "border-line"}`}>
                <input type="radio" name={`${id}-asset`} className="sr-only" checked={value.assetId === asset.id} onChange={() => onChange({ ...value, assetId: asset.id })} aria-label={`Picture uploaded ${asset.width} by ${asset.height}${asset.state === "DRAFT" ? ", not published yet" : ""}`} />
                {/* eslint-disable-next-line @next/next/no-img-element -- owner-only view of a private picture */}
                <img src={asset.previewPath} alt="" width={96} height={64} className="h-16 w-24 rounded-control object-cover" />
                <span className="mt-1 block text-center text-xs text-ink-soft">{value.assetId === asset.id ? "Chosen" : asset.state === "DRAFT" ? "New" : "In use"}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div>
        <label htmlFor={`${id}-upload`} className="block text-sm font-semibold text-ink">Upload a new picture</label>
        <input id={`${id}-upload`} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} className="mt-2 block w-full text-sm" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
        <p className="mt-1 text-xs text-ink-soft">JPG, PNG or WebP, up to 10 MB. It is not shown to visitors until you publish.</p>
        {busy && <p role="status" className="mt-1 text-sm text-ink-soft">Uploading…</p>}
        {problem && <p role="alert" className="mt-1 text-sm font-semibold text-danger">{problem}</p>}
      </div>
      {value.assetId && (
        <>
          <Checkbox id={`${id}-decor`} label="This picture is decoration only" help="Screen readers will skip it. Leave this off if the picture shows something visitors should know about." checked={value.decorative} onChange={(e) => onChange({ ...value, decorative: e.target.checked, alt: e.target.checked ? "" : value.alt })} />
          {!value.decorative && <Field id={`${id}-alt`} label="Describe the picture in a few words" help="Read aloud to people who cannot see it." value={value.alt} maxLength={160} onChange={(e) => onChange({ ...value, alt: e.target.value })} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-fx`} className="block text-sm font-semibold text-ink">Keep this part visible: left to right ({value.focalX}%)</label>
              <input id={`${id}-fx`} type="range" min={0} max={100} value={value.focalX} onChange={(e) => onChange({ ...value, focalX: Number(e.target.value) })} className="mt-2 w-full" />
            </div>
            <div>
              <label htmlFor={`${id}-fy`} className="block text-sm font-semibold text-ink">Keep this part visible: top to bottom ({value.focalY}%)</label>
              <input id={`${id}-fy`} type="range" min={0} max={100} value={value.focalY} onChange={(e) => onChange({ ...value, focalY: Number(e.target.value) })} className="mt-2 w-full" />
            </div>
          </div>
          <ImageCropPreview src={draftAssetPath(value.assetId)} alt={value.alt} decorative={value.decorative} focalX={value.focalX} focalY={value.focalY} />
        </>
      )}
    </div>
  );
}

function PromotionEditor({
  id, value, onChange, assets, onUploaded, nowIso,
}: { id: string; value: PromotionValue; onChange: (next: PromotionValue) => void; assets: AssetInfo[]; onUploaded: (a: AssetInfo) => void; nowIso: string }) {
  const start = utcToDenverLocal(value.startsAtUtc);
  const end = utcToDenverLocal(value.endsAtUtc);
  const [startDate, setStartDate] = useState(start.date);
  const [startTime, setStartTime] = useState(start.time || "00:00");
  const [endDate, setEndDate] = useState(end.date);
  const [endTime, setEndTime] = useState(end.time || "23:59");
  const apply = (sd: string, st: string, ed: string, et: string) => {
    const next: PromotionValue = { ...value };
    delete next.startsAtUtc; delete next.endsAtUtc;
    const s = sd ? denverLocalToUtc(sd, st || "00:00") : null;
    const e = ed ? denverLocalToUtc(ed, et || "23:59") : null;
    if (s) next.startsAtUtc = s;
    if (e) next.endsAtUtc = e;
    onChange(next);
  };
  return (
    <div className="space-y-5">
      <Checkbox id={`${id}-on`} label="Show this promotion" help="Off means visitors never see it, whatever the dates say." checked={value.enabled} onChange={(e) => onChange({ ...value, enabled: e.target.checked })} />
      <Field id={`${id}-title`} label="Title" value={value.title} maxLength={120} onChange={(e) => onChange({ ...value, title: e.target.value })} />
      <Textarea id={`${id}-body`} label="Details" rows={3} value={value.body} maxLength={600} onChange={(e) => onChange({ ...value, body: e.target.value })} />
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink">When it shows (Colorado time)</legend>
        <p className="text-xs text-ink-soft">Leave both empty to show it from the moment you publish until you switch it off.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${id}-sd`} type="date" label="Starts on" value={startDate} onChange={(e) => { setStartDate(e.target.value); apply(e.target.value, startTime, endDate, endTime); }} />
          <Field id={`${id}-st`} type="time" label="Starts at" value={startTime} onChange={(e) => { setStartTime(e.target.value); apply(startDate, e.target.value, endDate, endTime); }} />
          <Field id={`${id}-ed`} type="date" label="Ends on" value={endDate} onChange={(e) => { setEndDate(e.target.value); apply(startDate, startTime, e.target.value, endTime); }} />
          <Field id={`${id}-et`} type="time" label="Ends at" value={endTime} onChange={(e) => { setEndTime(e.target.value); apply(startDate, startTime, endDate, e.target.value); }} />
        </div>
        <p role="status" className="rounded-control bg-subtle p-3 text-sm text-ink">{describePromotionSchedule(value, new Date(nowIso))}</p>
      </fieldset>
      <fieldset className="space-y-3 rounded-control border border-line p-3">
        <legend className="px-1 text-sm font-semibold text-ink">Button (optional)</legend>
        <Checkbox id={`${id}-cta`} label="Add a button" checked={!!value.cta} onChange={(e) => { const next = { ...value }; if (e.target.checked) next.cta = emptyLink(); else delete next.cta; onChange(next); }} />
        {value.cta && <LinkEditor id={`${id}-cta-link`} labelText="Button" value={value.cta} onChange={(cta) => onChange({ ...value, cta })} />}
      </fieldset>
      <fieldset className="space-y-3 rounded-control border border-line p-3">
        <legend className="px-1 text-sm font-semibold text-ink">Picture (optional)</legend>
        <Checkbox id={`${id}-img`} label="Add a picture" checked={!!value.image} onChange={(e) => { const next = { ...value }; if (e.target.checked) next.image = emptyImage(); else delete next.image; onChange(next); }} />
        {value.image && <ImageEditor id={`${id}-image`} labelText="Promotion picture" value={value.image} onChange={(image) => onChange({ ...value, image })} assets={assets} onUploaded={onUploaded} />}
      </fieldset>
    </div>
  );
}

/** The panel for one item: where it appears, what is live, the form for its kind, and the limit or restore button. */
export function FieldEditor({
  field, value, defaultValue, live, facts, assets, nowIso, onChange, onUploaded,
}: {
  field: EditorField;
  /** What the draft holds for this item (undefined = the recommended starting value). */
  value: SiteValue | undefined;
  defaultValue: SiteValue | undefined;
  live: SiteValue | undefined;
  facts: Record<string, string>;
  assets: AssetInfo[];
  nowIso: string;
  onChange: (next: SiteValue | undefined) => void;
  onUploaded: (asset: AssetInfo) => void;
}) {
  const id = useId();
  const current = value ?? defaultValue;
  const hidden = current?.kind === "hidden";
  const changed = value !== undefined;
  const placeholderNames = field.placeholders.filter((p) => facts[p] !== undefined && facts[p] !== "");

  let form: React.ReactNode;
  if (hidden && field.optional) {
    form = <p className="text-sm text-ink-soft">This item is switched off. Visitors do not see it.</p>;
  } else if (field.valueKind === "text") {
    const text = current?.kind === "text" ? current.text : field.defaultText;
    const label = field.label;
    const common = {
      id: `${id}-text`, label, value: text, maxLength: field.maxLength + 200,
      help: `${field.help}${field.links ? " You can make words a link like this: [words](/pricing)." : ""}`,
      error: text.length > field.maxLength ? `That is ${text.length - field.maxLength} characters too long (the most is ${field.maxLength}).` : undefined,
    };
    form = (
      <div>
        {field.multiline
          ? <Textarea {...common} rows={5} onChange={(e) => onChange({ kind: "text", text: e.target.value })} />
          : <Field {...common} inputMode={field.address ? "url" : undefined} onChange={(e) => onChange({ kind: "text", text: e.target.value })} />}
        <p className="mt-1 text-xs text-ink-soft" aria-live="polite">{text.length} of {field.maxLength} characters</p>
        {placeholderNames.length > 0 && (
          <p className="mt-1 text-xs text-ink-soft">
            You can type {placeholderNames.map((p) => `{${p}}`).join(", ")} and the website fills in your real details: {placeholderNames.map((p) => `{${p}} shows as “${facts[p]}”`).join("; ")}.
          </p>
        )}
      </div>
    );
  } else if (field.valueKind === "link") {
    form = <LinkEditor id={id} labelText={field.label} value={current?.kind === "link" ? current : emptyLink()} onChange={onChange} />;
  } else if (field.valueKind === "image") {
    form = <ImageEditor id={id} labelText={field.label} value={current?.kind === "image" ? current : emptyImage()} onChange={onChange} assets={assets} onUploaded={onUploaded} />;
  } else if (field.valueKind === "promotion") {
    const base: PromotionValue = current?.kind === "promotion" ? current : { kind: "promotion", title: "", body: "", enabled: false };
    form = <PromotionEditor id={id} value={base} onChange={onChange} assets={assets} onUploaded={onUploaded} nowIso={nowIso} />;
  } else {
    form = <p className="text-sm text-ink-soft">This kind of item cannot be edited here yet.</p>;
  }

  return (
    <section aria-labelledby={`${id}-h`} className="space-y-4">
      <div>
        <h3 id={`${id}-h`} className="text-lg font-semibold text-ink">{field.label}</h3>
        <p className="mt-1 text-sm text-ink-soft">Appears on: {field.where}.</p>
        {field.shared.length > 0 && <p className="mt-1 text-sm text-ink-soft">Also shown on: {field.shared.join("; ")}.</p>}
        <p className="mt-1 text-sm text-ink-soft">Takes effect when you publish. Until then visitors see the live version.</p>
      </div>
      <div className="rounded-control bg-subtle p-3 text-sm">
        <p className="font-semibold text-ink">Live now</p>
        <p className="mt-1 text-ink"><ValueView summary={summarizeValue(live)} nowIso={nowIso} /></p>
        {changed && <>
          <p className="mt-3 font-semibold text-ink">Your proposed change</p>
          <p className="mt-1 text-ink"><ValueView summary={summarizeValue(value)} nowIso={nowIso} /></p>
        </>}
      </div>
      {form}
      <div className="flex flex-wrap gap-3">
        {field.optional && (
          <Button variant="secondary" onClick={() => onChange(hidden ? undefined : { kind: "hidden" })}>
            {hidden ? "Show this again" : field.valueKind === "promotion" ? "Switch off" : "Hide this"}
          </Button>
        )}
        {changed && <Button variant="quiet" onClick={() => onChange(undefined)}>Restore recommended</Button>}
      </div>
    </section>
  );
}
