import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,describe,expect,it,vi} from "vitest";
const actor=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/session",()=>({requireRole:actor}));
import {prisma} from "@/lib/prisma";
import {getContextEvidence} from "@/domains/messaging/context-evidence";

const u=new URL(process.env.DATABASE_URL??"postgresql://localhost/empty");
const enabled=process.env.CI==="true" && ["localhost","127.0.0.1"].includes(u.hostname) &&
 u.pathname==="/appliance_desk_test";
const tag=randomUUID().slice(0,12);
const staffId="l14b-staff-"+tag,assignedId="l14b-job-a-"+tag,otherId="l14b-job-b-"+tag;
const when=new Date("2026-10-10T12:00:00Z");
describe.skipIf(!enabled)("COM-L14B scoped context facts (disposable PostgreSQL)",()=>{
 beforeAll(async()=>{
  actor.mockResolvedValue({user:{id:staffId,role:"STAFF"}});
  await prisma.user.create({data:{id:staffId,email:"l14b-"+tag+"@example.test",role:"STAFF"}});
  await prisma.job.createMany({data:[
   {id:assignedId,type:"DELIVERY",status:"SCHEDULED",assignedToUserId:staffId},
   {id:otherId,type:"DELIVERY",status:"SCHEDULED"},
  ]});
  for(const [name,subjectId] of [["good",assignedId],["other",otherId]] as const){
   await prisma.messageDelivery.create({data:{
    id:"l14b-delivery-"+name+"-"+tag,idempotencyKey:"l14b-"+name+"-"+tag,
    channel:"SMS",purpose:"TRANSACTIONAL",templateKey:"test-context",
    recipientType:"ContactPoint",recipientAddress:"+15550001000",
    subjectType:"Job",subjectId,
    state:name==="good"?"ACCEPTED":"DELIVERED",requestedAt:when,
   }});
  }
 });
 afterAll(async()=>{
  await prisma.messageDelivery.deleteMany({where:{
   id:{in:["l14b-delivery-good-"+tag,"l14b-delivery-other-"+tag]},
  }});
  await prisma.job.deleteMany({where:{id:{in:[assignedId,otherId]}}});
  await prisma.user.deleteMany({where:{id:staffId}});
 });
 it("only returns assigned job and never broadens to a sibling job",async()=>{
  const valid=await getContextEvidence("Job",assignedId);
  expect(valid.entries).toHaveLength(1);
  expect(valid.entries[0].status).toMatch(/not confirmed delivered/);
  expect(valid.entries[0].href).toBeNull();
  expect((await getContextEvidence("Job",otherId)).restricted).toBe(true);
  expect((await getContextEvidence("Invoice","invoice-X")).restricted).toBe(true);
 });
 it("allows owner to inspect only exact job subject without global billing facts",async()=>{
  actor.mockResolvedValue({user:{id:"owner",role:"OWNER"}});
  const rows=await getContextEvidence("Job",otherId);
  expect(rows.entries).toHaveLength(1);
  expect(rows.entries[0].status).toMatch(/provider confirmed/);
  expect(JSON.stringify(rows)).not.toContain(assignedId);
 });
});
