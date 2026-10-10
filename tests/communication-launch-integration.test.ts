import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,describe,expect,it,vi} from "vitest";
const requireTeamRole=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/session",()=>({requireRole:requireTeamRole}));
import {prisma} from "@/lib/prisma";
import {isLegacySmsDispatchEnabled} from "@/domains/messaging/sms-activation";
import {getContextEvidence} from "@/domains/messaging/context-evidence";

const u=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true" &&
 ["localhost","127.0.0.1"].includes(u.hostname)&&u.pathname==="/appliance_desk_test";
const mark=randomUUID().replaceAll("-","").slice(0,12);
const staffId="l15-staff-"+mark,jobId="l15-job-"+mark;
const stamp=new Date("2026-10-10T10:00:00Z");
describe.skipIf(!enabled)("COM-L15 non-sending launch safety proof (isolated PostgreSQL)",()=>{
 beforeAll(async()=>{
  await prisma.user.create({data:{
   id:staffId,email:"l15-"+mark+"@example.test",role:"STAFF",
  }});
  await prisma.job.create({data:{
   id:jobId,type:"DELIVERY",status:"SCHEDULED",assignedToUserId:staffId,
  }});
  for(const [suffix,state] of [["accepted","ACCEPTED"],["delivered","DELIVERED"],["unknown","UNKNOWN"]] as const) {
   await prisma.messageDelivery.create({data:{
    id:"l15-"+suffix+"-"+mark,idempotencyKey:"l15-"+suffix+"-"+mark,
    channel:"SMS",purpose:"TRANSACTIONAL",templateKey:"synthetic-launch",
    recipientType:"ContactPoint",recipientAddress:"+15555550000",
    subjectType:"Job",subjectId:jobId,state,requestedAt:stamp,
   }});
  }
 });
 afterAll(async()=>{
  await prisma.messageDelivery.deleteMany({where:{
   id:{in:["accepted","delivered","unknown"].map(x=>"l15-"+x+"-"+mark)},
  }});
  await prisma.job.deleteMany({where:{id:jobId}});
  await prisma.user.deleteMany({where:{id:staffId}});
 });
 it("does not mistake an unactivated seeded master switch for live permission",async()=>{
  const settings=await prisma.businessSettings.findUniqueOrThrow({
   where:{id:"singleton"},select:{customerSmsEnabled:true},
  });
  expect(settings.customerSmsEnabled).toBe(false);
  expect(await isLegacySmsDispatchEnabled()).toBe(false);
 });
 it("distinguishes provider acceptance, confirmed delivery and unknown outcome",async()=>{
  requireTeamRole.mockResolvedValue({user:{id:staffId,role:"STAFF"}});
  const scoped=await getContextEvidence("Job",jobId);
  expect(scoped.restricted).toBe(false);
  expect(scoped.entries).toHaveLength(3);
  const states=scoped.entries.map(x=>x.status);
  expect(states.some(x=>x.includes("not confirmed delivered"))).toBe(true);
  expect(states.some(x=>x.includes("provider confirmed"))).toBe(true);
  expect(states.some(x=>x.includes("verify before retry"))).toBe(true);
  expect(scoped.entries.every(x=>x.href===null)).toBe(true);
  expect(JSON.stringify(scoped)).not.toContain("+15555550000");
  expect(JSON.stringify(scoped)).not.toContain("synthetic-launch");
 });
 it("does not open company billing or an unrelated record to STAFF",async()=>{
  requireTeamRole.mockResolvedValue({user:{id:staffId,role:"STAFF"}});
  expect((await getContextEvidence("Invoice","unrelated")).restricted).toBe(true);
  expect((await getContextEvidence("Job","unrelated")).restricted).toBe(true);
  expect((await getContextEvidence("MaintenanceRequest","unrelated")).restricted).toBe(true);
 });
});
