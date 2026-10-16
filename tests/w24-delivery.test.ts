import { describe, expect, it } from "vitest";
import {
  mileageBand, reviewedDrivingFee, todayDenver, readOfferedSlots,
  assertAvailableDeliveryOption, validateDeliveryConfirmation,
} from "@/domains/orders/delivery";
const id="22222222-2222-4222-8222-222222222222";
const slot={id,date:"2026-11-01",window:"AM" as const};
const selection={optionId:id,expectedOfferVersion:3,questions:{
  dryerOutlet:"FOUR_PRONG" as const,stairs:true,washerHookups:"YES" as const,
  crewNotes:"Back alley",}};
const windows={morningStart:8,morningEnd:12,afternoonStart:12,afternoonEnd:17};
describe("W-24 owner offered delivery, verified miles and first confirmation",()=>{
  it("uses exact 15, 30 and 50 driving-mile boundaries",()=>{
    expect(mileageBand(0)).toMatchObject({allowed:true,amountCents:0});
    expect(mileageBand(15).amountCents).toBe(0);
    expect(mileageBand(15.001).amountCents).toBe(7500);
    expect(mileageBand(30).amountCents).toBe(7500);
    expect(mileageBand(30.001).amountCents).toBe(12500);
    expect(mileageBand(50).amountCents).toBe(12500);
    expect(mileageBand(50.0001)).toMatchObject({allowed:false,amountCents:null});
    for(const distance of [-1,NaN,Infinity])
      expect(()=>mileageBand(distance)).toThrow();
  });
  it("requires sourced driving miles for the configured origin, not a straight line",()=>{
    const proof={miles:29.5,source:"OWNER_MANUAL_DRIVING_ROUTE",
      sourceReference:"Odometer and verified road route 2026-10-15",
      measuredAt:"2026-10-15T12:00:00.000Z",origin:"Central Greeley, CO"};
    expect(reviewedDrivingFee(proof,"Central Greeley, CO",new Date("2026-10-15T13:00:00Z")).amountCents).toBe(7500);
    expect(()=>reviewedDrivingFee({...proof,source:"ZIP_POLYGON"},
      "Central Greeley, CO",new Date("2026-10-15T13:00:00Z"))).toThrow();
    expect(()=>reviewedDrivingFee(proof,"New origin, Greeley",new Date("2026-10-15T13:00:00Z"))).toThrow();
    expect(()=>reviewedDrivingFee(proof,"Central Greeley, CO",
      new Date("2026-11-15T13:00:00Z"))).toThrow(/stale/i);
    expect(()=>reviewedDrivingFee({...proof,miles:51},
      "Central Greeley, CO",new Date("2026-10-15T13:00:00Z"))).toThrow(/outside/i);
  });
  it("never treats offered slots as a booking; rejects stale/removed and past ones",()=>{
    expect(readOfferedSlots([slot])).toEqual([slot]);
    expect(assertAvailableDeliveryOption([slot],3,selection,new Date("2026-10-25T00:00:00Z")))
      .toMatchObject({offeredVersion:3,slot});
    expect(()=>assertAvailableDeliveryOption([slot],4,selection)).toThrow(/changed/i);
    expect(()=>assertAvailableDeliveryOption([],3,selection)).toThrow(/changed/i);
    expect(()=>assertAvailableDeliveryOption([slot],3,selection,new Date("2026-11-05T00:00:00Z")))
      .toThrow(/past/i);
  });
  it("confirms only within the offered Denver window across DST",()=>{
    expect(validateDeliveryConfirmation({requested:{slot},scheduledAt:new Date("2026-11-01T16:30:00Z"),
      windows}).date).toBe("2026-11-01");
    expect(()=>validateDeliveryConfirmation({requested:{slot},scheduledAt:new Date("2026-11-01T20:00:00Z"),
      windows})).toThrow(/outside/i);
    expect(()=>validateDeliveryConfirmation({requested:{slot},scheduledAt:new Date("2026-11-02T16:00:00Z"),
      windows})).toThrow(/date/i);
    expect(todayDenver(new Date("2026-11-01T03:00:00Z"))).toBe("2026-10-31");
  });
});
