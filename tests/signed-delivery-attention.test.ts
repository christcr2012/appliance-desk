import {beforeEach,describe,expect,it,vi} from "vitest";
const mock=vi.hoisted(()=>({role:vi.fn(),findMany:vi.fn(),count:vi.fn()}));
vi.mock("@/lib/session",()=>({requireRole:mock.role}));
vi.mock("@/lib/prisma",()=>({prisma:{job:{findMany:mock.findMany,count:mock.count}}}));
import {listSignedDeliveryAttention} from "@/domains/exceptions/signed-delivery-attention";

describe("signed agreement delivery To do",()=>{
 beforeEach(()=>{
  mock.role.mockReset().mockResolvedValue({user:{id:"owner"}});
  mock.findMany.mockReset().mockResolvedValue([{
   id:"job-delivery-1",createdAt:new Date("2026-10-14T10:00:00Z"),
   agreement:{signature:{signedAt:new Date("2026-10-14T16:30:00Z")},customer:{user:{name:"Customer A",email:"customer@example.test"}}},
  }]);
  mock.count.mockReset().mockResolvedValue(1);
 });
 it("links the real unscheduled delivery draft without implying payment",async()=>{
  const result=await listSignedDeliveryAttention(10);
  expect(result.total).toBe(1);
  expect(result.rows).toMatchObject([{
   category:"SIGNED_DELIVERY_UNSCHEDULED",
   title:"Schedule Customer A's delivery",
   dueOn:new Date("2026-10-15T00:00:00Z"),dueDateOnly:true,
   href:"/desk/jobs/job-delivery-1",
   primaryAction:{href:"/desk/jobs/job-delivery-1",label:"Schedule delivery"},
  }]);
  expect(result.rows[0].detail).toMatch(/Confirm signing payment/);
  const query=mock.findMany.mock.calls[0][0];
  expect(query.where).toMatchObject({status:"SCHEDULED",scheduledAt:null,type:"DELIVERY",
   agreement:{is:{status:"ACTIVE",firstDeliveredOn:null,renewedFromAgreementId:null}}});
 });
 it("a customer pickup hand-over says what to hand over to whom, never 'Schedule delivery' (ZONE-1)",async()=>{
  mock.findMany.mockResolvedValueOnce([{
   id:"job-handoff-1",createdAt:new Date("2026-10-14T10:00:00Z"),customerPickupHandoff:true,
   agreement:{signature:{signedAt:new Date("2026-10-14T16:30:00Z")},customer:{user:{name:"Customer B",email:"b@example.test"}},
    lines:[{label:"Washer/Dryer set",assignments:[{appliance:{applianceType:{name:"Washer"}}},{appliance:{applianceType:{name:"Dryer"}}}]}]},
  }]);
  const result=await listSignedDeliveryAttention(10);
  expect(result.rows[0]).toMatchObject({
   title:"Customer pickup: hand over Washer and Dryer to Customer B",
   href:"/desk/jobs/job-handoff-1",primaryAction:{href:"/desk/jobs/job-handoff-1",label:"Open hand-over"},
  });
  expect(JSON.stringify(result.rows[0])).not.toMatch(/Schedule|delivery visit/);
  expect(result.rows[0].detail).toMatch(/Handed over/);
  // Before any unit is set aside, the rental line names are used.
  mock.findMany.mockResolvedValueOnce([{id:"job-handoff-2",createdAt:new Date(),customerPickupHandoff:true,
   agreement:{customer:{user:{name:null,email:"c@example.test"}},lines:[{label:"Chest freezer",assignments:[]}]}}]);
  expect((await listSignedDeliveryAttention(10)).rows[0].title).toBe("Customer pickup: hand over Chest freezer to c@example.test");
 });
 it("rejects invalid limits and requires owner/admin",async()=>{
  await expect(listSignedDeliveryAttention(0)).rejects.toThrow(/bounded/);
  await expect(listSignedDeliveryAttention(51)).rejects.toThrow(/bounded/);
  expect(mock.role).toHaveBeenCalledWith("OWNER","ADMIN");
  mock.role.mockRejectedValueOnce(new Error("Owner only"));
  await expect(listSignedDeliveryAttention(10)).rejects.toThrow("Owner only");
 });
 it("queries the bounded total only when capped",async()=>{
  mock.findMany.mockResolvedValueOnce([]);
  expect((await listSignedDeliveryAttention(10)).total).toBe(0);
  expect(mock.count).not.toHaveBeenCalled();
  mock.findMany.mockResolvedValueOnce(Array(2).fill({
   id:"different",createdAt:new Date(),agreement:{customer:{user:{name:"A"}}},
  }));
  expect((await listSignedDeliveryAttention(2)).total).toBe(1);
  expect(mock.count).toHaveBeenCalledTimes(1);
 });
});
