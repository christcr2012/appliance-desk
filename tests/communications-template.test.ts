import { describe, expect, it } from "vitest";
import { smsPreview, renderSmsTemplate, previewSmsTemplate, templateVariables } from "@/domains/messaging/sms-template";

describe("COM-L6A Twilio local SMS segment preview", () => {
  it("uses GSM-7 single/concat capacities, including exact boundaries", () => {
    expect(smsPreview("").segments).toBe(0);
    expect(smsPreview("a".repeat(160))).toMatchObject({ encoding:"GSM-7", units:160, segments:1 });
    expect(smsPreview("a".repeat(161))).toMatchObject({ encoding:"GSM-7", units:161, segments:2 });
    expect(smsPreview("a".repeat(306)).segments).toBe(2);
    expect(smsPreview("a".repeat(307)).segments).toBe(3);
  });
  it("counts GSM extension escape pairs and does not split them", () => {
    expect(smsPreview("^{}[]\\|€~").units).toBe(18);
    expect(smsPreview("a".repeat(158) + "^")).toMatchObject({ units:160, segments:1 });
    expect(smsPreview("a".repeat(159) + "^")).toMatchObject({ units:161, segments:2 });
    // 152 septets + an extension ESC pair cannot share the first 153 septet segment
    expect(smsPreview("a".repeat(152) + "^" + "b".repeat(152)).segments).toBe(3);
  });
  it("uses UCS-2 UTF-16 units including emoji/surrogates and non-GSM punctuation", () => {
    expect(smsPreview("“" + "a".repeat(69))).toMatchObject({
      encoding:"UCS-2", units:70, segments:1,
    });
    expect(smsPreview("“" + "a".repeat(70))).toMatchObject({
      encoding:"UCS-2", units:71, segments:2,
    });
    expect(smsPreview("😀".repeat(35))).toMatchObject({
      encoding:"UCS-2", units:70, segments:1,
    });
    expect(smsPreview("😀".repeat(36))).toMatchObject({
      encoding:"UCS-2", units:72, segments:2,
    });
    expect(smsPreview("😀".repeat(67)).segments).toBe(3);
  });
});

describe("COM-L6A strict variable render and previews", () => {
  const rules = { job_type: { example: "delivery", maxLength: 26 },
    street: { example:"Main St", maxLength:45 } };
  it("renders only declared, bounded variables and preserves footer", () => {
    const body = "Reminder: {{job_type}} at {{street}}. Reply STOP to opt out.";
    expect(templateVariables(body,rules)).toEqual(["job_type","street"]);
    expect(renderSmsTemplate(body, rules, {
      job_type:"delivery",street:"1 Main St",
    })).toBe("Reminder: delivery at 1 Main St. Reply STOP to opt out.");
  });
  it("rejects unknown, unclosed, missing, extra and excessive values", () => {
    expect(() => renderSmsTemplate("{{hack}}",rules,{ hack:"yes" })).toThrow();
    expect(() => renderSmsTemplate("{{job_type",rules,{})).toThrow();
    expect(() => renderSmsTemplate("{{job_type}}",rules,{})).toThrow();
    expect(() => renderSmsTemplate("{{job_type}}",rules,{job_type:"a".repeat(27)})).toThrow();
    expect(() => renderSmsTemplate("{{job_type}}",rules,{job_type:"ok",extra:"x"})).toThrow();
    expect(() => renderSmsTemplate("hi",rules,{job_type:"delivery"})).toThrow();
  });
  it("previews real and worst-known encoded segments without pretending a verified price", () => {
    const x=previewSmsTemplate("Visit today: {{job_type}} at {{street}}",rules,3);
    expect(x.sample.text).toContain("delivery");
    expect(x.sample.sms.costCents).toBeNull();
    expect(x.worstCase.sms.encoding).toBe("UCS-2");
    expect(x.allowed).toBe(true);
    expect(x.warning).toMatch(/Encoding|segment/);
    const tooLong=previewSmsTemplate("{{street}}".repeat(15),rules,2);
    expect(tooLong.allowed).toBe(false);
  });
});
