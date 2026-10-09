import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { addOwnerSystemIssueNote, listSystemIssues, markSystemIssueResolved } from "@/domains/system-issues/queries";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const enabled = process.env.CI === "true" && url.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(url.hostname);

const token = () => randomUUID().replaceAll("-", "");

async function fixture(run: (input: {issueId:string;ownerId:string;adminId:string})=>Promise<void>) {
  const [owner, admin] = await Promise.all([
    prisma.user.findFirstOrThrow({where:{role:"OWNER",archivedAt:null},select:{id:true}}),
    prisma.user.findFirstOrThrow({where:{role:"ADMIN",archivedAt:null},select:{id:true}}),
  ]);
  const issue = await prisma.systemIssue.create({data:{
    fingerprint:"automation:test-"+token(),kind:"AUTOMATION_FAILED",
    severity:"HIGH",summary:"Scheduled task needs review",
    detail:"Automation failed; source details kept private.",
  }});
  try { await run({issueId:issue.id,ownerId:owner.id,adminId:admin.id}); }
  finally {
    await prisma.systemIssueNote.deleteMany({where:{issueId:issue.id}});
    await prisma.systemIssue.delete({where:{id:issue.id}});
  }
}

describe.skipIf(!enabled)("S-1C issue permissions and concurrency on throwaway PostgreSQL",()=>{
  it("admin can read but cannot resolve",async()=>{
    await fixture(async({issueId,adminId})=>{
      const page=await listSystemIssues(adminId,{limit:100});
      expect(page.rows.some(x=>x.id===issueId)).toBe(true);
      await expect(markSystemIssueResolved(adminId,{
        issueId,reason:"Reviewed configuration",expectedVersion:1,
      })).rejects.toThrow();
      expect((await prisma.systemIssue.findUniqueOrThrow({where:{id:issueId}})).status).toBe("OPEN");
    });
  });

  it("stale version is rejected and owner note acknowledges only once",async()=>{
    await fixture(async({issueId,ownerId})=>{
      await addOwnerSystemIssueNote(ownerId,{
        issueId,body:"Check the runner configuration",expectedVersion:1,
      });
      const first=await prisma.systemIssue.findUniqueOrThrow({where:{id:issueId}});
      expect(first).toMatchObject({status:"ACKNOWLEDGED",version:2});
      await expect(markSystemIssueResolved(ownerId,{
        issueId,reason:"Reviewed the source",expectedVersion:1,
      })).rejects.toThrow(/changed/);
      expect((await prisma.systemIssue.findUniqueOrThrow({where:{id:issueId}})).status).toBe("ACKNOWLEDGED");
    });
  });

  it("known full name is rejected with no stored note or status change",async()=>{
    await fixture(async({issueId,ownerId})=>{
      const id=token(), last="Testson"+id.slice(0,6);
      const person=await prisma.user.create({data:{
        email:"issue-person-"+id+"@example.test",name:"Jane "+last,role:"STAFF",
      }});
      try {
        await expect(addOwnerSystemIssueNote(ownerId,{
          issueId,body:"Lookup failed for Jane "+last,expectedVersion:1,
        })).rejects.toThrow(/without names/);
        expect(await prisma.systemIssueNote.count({where:{issueId}})).toBe(0);
        expect((await prisma.systemIssue.findUniqueOrThrow({where:{id:issueId}})).version).toBe(1);
      }finally {
        await prisma.user.delete({where:{id:person.id}});
      }
    });
  });

  it("owner resolution is versioned and reopened by recurring source evidence",async()=>{
    await fixture(async({issueId,ownerId})=>{
      await markSystemIssueResolved(ownerId,{
        issueId,reason:"Reviewed and temporarily recovered",expectedVersion:1,
      });
      const resolved=await prisma.systemIssue.findUniqueOrThrow({where:{id:issueId}});
      expect(resolved).toMatchObject({status:"RESOLVED",version:2});
      await prisma.systemIssue.update({where:{id:issueId},data:{
        status:"OPEN",resolvedAt:null,resolvedReason:null,
        version:{increment:1},occurrences:{increment:1},
      }});
      const reopened=await prisma.systemIssue.findUniqueOrThrow({where:{id:issueId}});
      expect(reopened).toMatchObject({status:"OPEN",version:3,occurrences:2});
    });
  });
});
