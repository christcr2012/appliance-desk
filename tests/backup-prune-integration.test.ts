import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { pruneBackups } from "@/domains/backup/artifacts";

const blob = vi.hoisted(()=>({del:vi.fn(),list:vi.fn()}));
vi.mock("@vercel/blob",()=>({del:blob.del,list:blob.list,get:vi.fn()}));
const url=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&["localhost","127.0.0.1"].includes(url.hostname)&&url.pathname==="/appliance_desk_test";
describe.skipIf(!enabled)("backup pruning (throwaway PostgreSQL)",()=>{
  const suffix=randomUUID();
  const d1="backup-db-old-"+suffix, m1="backup-media-old-"+suffix;
  const d2="backup-db-new-"+suffix, d3="backup-db-orphan-"+suffix;
  const make=(id:string,kind:"DATABASE"|"MEDIA_MANIFEST",date:Date,link?:string)=>({
    id,kind,state:"VERIFIED" as const,pathname:"backups/2026-07-01-"+id+".json",
    databaseArtifactId:link,createdAt:date,verifiedAt:date,formatVersion:2,
    sizeBytes:42,sha256:"a".repeat(64),
  });
  afterAll(async()=>{
    await prisma.backupArtifact.deleteMany({where:{id:m1}});
    await prisma.backupArtifact.deleteMany({where:{id:{in:[d1,d2,d3]}}});
  });
  it("keeps the last complete pair while removing stale unrelated files",async()=>{
    const old=new Date("2026-07-01T09:00:00.000Z");
    await prisma.backupArtifact.create({data:make(d1,"DATABASE",old)});
    await prisma.backupArtifact.create({data:make(m1,"MEDIA_MANIFEST",old,d1)});
    await prisma.backupArtifact.create({data:make(d3,"DATABASE",new Date("2026-07-02T09:00:00.000Z"))});
    await prisma.backupArtifact.create({data:{...make(d2,"DATABASE",new Date("2026-10-25T09:00:00.000Z")), pathname:"backups/2026-10-25-"+d2+".json"}});
    blob.del.mockResolvedValue(undefined);
    blob.list.mockResolvedValue({blobs:[],hasMore:false});
    const removed=await pruneBackups(new Date("2026-10-26T09:00:00.000Z"),30,"synthetic-private-token");
    expect(removed).toBe(1);
    expect((await prisma.backupArtifact.findUniqueOrThrow({where:{id:d3}})).state).toBe("PRUNED");
    for(const id of [d1,m1,d2])expect((await prisma.backupArtifact.findUniqueOrThrow({where:{id}})).state).toBe("VERIFIED");
    expect(blob.del).toHaveBeenCalledTimes(1);
  });
});
