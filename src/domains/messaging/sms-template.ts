/**
 * Pure SMS encoding/preview. Pricing is deliberately unknown until verified
 * provider/carrier pricing exists; "segments" is NOT a dollar estimate.
 * Twilio local SMS profile: GSM 160/153 septets, UCS-2 70/67 UTF-16 units.
 * Smart Encoding is deliberately disabled.
 */
const GSM_BASIC = new Set(Array.from(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ" +
  " !\"#¤%&'()*+,-./0123456789:;<=>?¡" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿" +
  "abcdefghijklmnopqrstuvwxyzäöñüà",
));
const GSM_EXTENSION = new Set(Array.from("\f^{}\\[~]|€"));

export type SmsPreview = {
  encoding: "GSM-7" | "UCS-2";
  units: number;
  segments: number;
  capacitySingle: number;
  capacityMultipart: number;
  nonGsmCharacters: string[];
  smartEncoding: false;
  costCents: null;
};

export function smsPreview(text: string): SmsPreview {
  const chars = Array.from(text);
  const nonGsmCharacters = [...new Set(chars.filter(
    ch => !GSM_BASIC.has(ch) && !GSM_EXTENSION.has(ch),
  ))];
  const gsm = nonGsmCharacters.length === 0;
  const encoding = gsm ? "GSM-7" : "UCS-2";
  const capacitySingle = gsm ? 160 : 70;
  const capacityMultipart = gsm ? 153 : 67;
  const weights = chars.map(ch => gsm ? (GSM_EXTENSION.has(ch) ? 2 : 1) : ch.length);
  const units = weights.reduce((a,b) => a+b, 0);
  // An extension's ESC pair (or UTF-16 surrogate pair) cannot be split across
  // segments, so counting only ceil(total/capacity) can undercount.
  let segments = 0;
  if (units > 0) {
    if (units <= capacitySingle) segments = 1;
    else {
      let used = 0;
      segments = 1;
      for (const n of weights) {
        if (used + n > capacityMultipart) { segments += 1; used = 0; }
        used += n;
      }
    }
  }
  return { encoding, units, segments, capacitySingle, capacityMultipart,
    nonGsmCharacters, smartEncoding: false, costCents: null };
}

export const TEMPLATE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const PLACEHOLDER = /{{\s*([^{}]+?)\s*}}/g;
export type VariableRules = Record<string, { example: string; maxLength: number }>;
export type TemplatePreview = {
  sample: { text: string; sms: SmsPreview };
  worstCase: { text: string; sms: SmsPreview };
  variableNames: string[];
  maxSegments: number;
  allowed: boolean;
  warning: string | null;
};

/** Throws for any unclosed/unknown brace, unapproved key or missing variable. */
export function templateVariables(body: string, rules: VariableRules): string[] {
  if (!body.trim() || body.length > 1600 || !rules ||
    Object.keys(rules).length > 25) throw new Error("Invalid SMS template body or variables.");
  const found = new Set<string>();
  const stripped = body.replace(PLACEHOLDER, (_match, key: string) => {
    if (!TEMPLATE_KEY_PATTERN.test(key) || !Object.hasOwn(rules, key)) {
      throw new Error("Unknown SMS template variable.");
    }
    const rule = rules[key];
    if (typeof rule.example !== "string" || rule.example.length > 1600 ||
      !Number.isInteger(rule.maxLength) || rule.maxLength < 1 ||
      rule.maxLength > 1600 || rule.example.length > rule.maxLength) {
      throw new Error("Invalid SMS template variable rule.");
    }
    found.add(key);
    return "";
  });
  if (/[{}]/.test(stripped)) throw new Error("Malformed SMS template variable.");
  return [...found];
}

export function renderSmsTemplate(
  body: string, rules: VariableRules, values: Record<string, string>,
): string {
  const required = templateVariables(body, rules);
  if (Object.keys(values).some(k => !required.includes(k)) ||
    required.some(k => typeof values[k] !== "string" ||
      values[k].length > rules[k].maxLength)) {
    throw new Error("Missing or overlong SMS template variable.");
  }
  return body.replace(PLACEHOLDER, (_m, key: string) => values[key]);
}

export function previewSmsTemplate(
  body: string, rules: VariableRules, maxSegments: number,
): TemplatePreview {
  if (!Number.isSafeInteger(maxSegments) || maxSegments < 1 || maxSegments > 10) {
    throw new Error("Invalid SMS segment limit.");
  }
  const names = templateVariables(body, rules);
  const example: Record<string, string> = {};
  const worst: Record<string, string> = {};
  for (const name of names) {
    example[name] = rules[name].example;
    // A variable may contain non-GSM Unicode even if the example is ASCII.
    // The cost-facing worst known is deliberately UCS-2 with maximum units;
    // values still must be reviewed at send time.
    worst[name] = "界".repeat(rules[name].maxLength);
  }
  const sampleText = renderSmsTemplate(body, rules, example);
  const worstText = renderSmsTemplate(body, rules, worst);
  const sampleSms = smsPreview(sampleText);
  const worstSms = smsPreview(worstText);
  const allowed = sampleSms.segments <= maxSegments &&
    worstSms.segments <= maxSegments && sampleText.length <= 1600 &&
    worstText.length <= 1600;
  return { sample: {text: sampleText, sms: sampleSms },
    worstCase: { text: worstText, sms: worstSms }, variableNames: names,
    maxSegments, allowed,
    warning: !allowed ? "Preview exceeds SMS segment limit; revise wording or variable maximums."
      : sampleSms.encoding !== worstSms.encoding || sampleSms.segments !== worstSms.segments
        ? "Encoding or segment count can change when real values are rendered." : null };
}
