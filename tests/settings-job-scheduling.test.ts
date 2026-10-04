import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { vi } from "vitest";

vi.mock("@/app/desk/settings/actions", () => ({ updateJobSchedulingAction: vi.fn() }));

import { jobSchedulingDefaults, jobSchedulingUpdate, RECOMMENDED_JOB_DURATION_MINUTES } from "@/domains/settings/job-scheduling";
import { JobSchedulingForm } from "@/app/desk/settings/job-scheduling-form";

describe("Visits and scheduling setting", () => {
  it("accepts whole minutes from 15 to 720 and refuses everything else", () => {
    expect(jobSchedulingUpdate({ defaultJobDurationMinutes: "90", staffMayWorkUnassignedJobs: true })).toEqual({
      success: true,
      update: { defaultJobDurationMinutes: 90, staffMayWorkUnassignedJobs: true },
    });
    expect(jobSchedulingUpdate({ defaultJobDurationMinutes: 720, staffMayWorkUnassignedJobs: false })).toMatchObject({
      success: true,
      update: { staffMayWorkUnassignedJobs: false },
    });
    for (const bad of ["14", "721", "1.5", "-5", "abc", "", "1e2"]) {
      expect(jobSchedulingUpdate({ defaultJobDurationMinutes: bad, staffMayWorkUnassignedJobs: true })).toMatchObject({ success: false });
    }
    expect(jobSchedulingUpdate({})).toMatchObject({ success: false });
    expect(jobSchedulingUpdate({ defaultJobDurationMinutes: "90" })).toMatchObject({ success: false });
    expect(jobSchedulingUpdate({ defaultJobDurationMinutes: "90", staffMayWorkUnassignedJobs: "yes" })).toMatchObject({ success: false });
  });

  it("starts at 120 minutes and the screen explains the setting in plain words with a restore button", () => {
    expect(RECOMMENDED_JOB_DURATION_MINUTES).toBe(120);
    const html = renderToStaticMarkup(
      createElement(JobSchedulingForm, { defaultValues: jobSchedulingDefaults({ defaultJobDurationMinutes: 90, staffMayWorkUnassignedJobs: true }) }),
    );
    expect(html).toContain("Usual visit length");
    expect(html).toContain("overlap");
    expect(html).toContain("Starting value: 120");
    expect(html).toContain("owner or admin");
    expect(html).toContain("Restore recommended values");
    expect(html).toContain("Can staff work jobs nobody is assigned to?");
    expect(html).toContain("Starting value: on");
    expect(html).toMatch(/checked=""/);
    expect(html).toContain('value="90"');
  });
});
