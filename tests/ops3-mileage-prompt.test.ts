import { describe, expect, it } from "vitest";
import { mileagePrompt } from "@/domains/vehicle/driver-prompt";

const open = { id: "t", startOdometer: 100, endOdometer: null, miles: null };
const done = { id: "t", startOdometer: 100, endOdometer: 140, miles: 40 };

describe("driver mileage prompt", () => {
  it("asks for the starting odometer before the first stop when the day has stops and no trip yet", () => {
    expect(mileagePrompt({ total: 3, finished: 0 }, null)).toBe("FIRST_STOP");
  });
  it("asks for the ending odometer once every stop is finished and the trip is still open", () => {
    expect(mileagePrompt({ total: 3, finished: 3 }, open)).toBe("LAST_STOP");
  });
  it("stays quiet mid-route, after the day is closed, and on days with no stops", () => {
    expect(mileagePrompt({ total: 3, finished: 1 }, open)).toBeNull();
    expect(mileagePrompt({ total: 3, finished: 3 }, done)).toBeNull();
    expect(mileagePrompt({ total: 0, finished: 0 }, null)).toBeNull();
  });
});
