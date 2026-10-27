import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Artifact = { id: string; pathname: string; kind: "DATABASE" | "MEDIA_MANIFEST";
  state: "VERIFIED" | "FAILED" | "PRUNED" | "UPLOADED_UNVERIFIED";
  databaseArtifactId?: string; createdAt: Date; mediaManifests?: Artifact[] };
const f = vi.hoisted(() => ({
  artifacts: [] as Artifact[],
  del: vi.fn(), get: vi.fn(), list: vi.fn(),
}));
vi.mock("@vercel/blob", () => ({ del: f.del, get: f.get, list: f.list }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  backupArtifact: {
    findFirst: vi.fn(async (q: {where: {kind: string;state: string;mediaManifests?: unknown};
      orderBy: unknown; include?: unknown }) => {
      const rows = [...f.artifacts].filter(a=>a.kind===q.where.kind&&a.state===q.where.state);
      const matched = q.where.mediaManifests
        ? rows.filter(a=>f.artifacts.some(m=>m.kind==="MEDIA_MANIFEST"&&
          m.databaseArtifactId===a.id&&m.state==="VERIFIED"))
        : rows;
      matched.sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime());
      const chosen=matched[0];
      return chosen ? {...chosen, mediaManifests: f.artifacts.filter(m=>
        m.databaseArtifactId===chosen.id&&m.state==="VERIFIED")} : null;
    }),
    findMany: vi.fn(async () => [...f.artifacts].filter(a=>a.state!=="PRUNED"&&
      a.createdAt.getTime()<Date.UTC(2026,8,25))),
    count: vi.fn(async ({where}:{where:{databaseArtifactId:string}}) =>
      f.artifacts.filter(a=>a.databaseArtifactId===where.databaseArtifactId&&a.state!=="PRUNED").length),
    findUnique: vi.fn(async ({where}:{where:{pathname:string}}) =>
      f.artifacts.find(a=>a.pathname===where.pathname)??null),
    update: vi.fn(async ({where,data}:{where:{id:string};data:{state:"PRUNED"}}) => {
      const a=f.artifacts.find(a=>a.id===where.id)!;a.state=data.state;return a;
    }),
  },
}}));
import { backupDigest, pruneBackups, verifyBackupReadback } from "@/domains/backup/artifacts";

const at=(day:string)=>new Date(day+"T10:00:00.000Z");
const db=(id:string,day:string):Artifact=>({id,pathname:"backups/"+day+"-"+id+".json",
  kind:"DATABASE",state:"VERIFIED",createdAt:at(day)});

beforeEach(() => {
  f.artifacts.length=0;f.del.mockReset().mockResolvedValue(undefined);
  f.get.mockReset();f.list.mockReset().mockResolvedValue({blobs:[],hasMore:false});
});

describe("backup verified evidence and immutable recovery floor", () => {
  it("checks the exact private pathname and SHA-256 on readback", async () => {
    const bytes=Buffer.from("isolated synthetic archive");
    const digest=createHash("sha256").update(bytes).digest("hex");
    expect(backupDigest(bytes)).toBe(digest);
    f.get.mockImplementation(async () => ({statusCode:200,blob:{pathname:"backups/example.json"},
      stream:new Blob([bytes]).stream()}));
    expect(await verifyBackupReadback("backups/example.json","synthetic-private-token",digest)).toBe(true);
    expect(await verifyBackupReadback("backups/example.json","synthetic-private-token","0".repeat(64))).toBe(false);
    f.get.mockImplementation(async () => ({statusCode:200,blob:{pathname:"backups/wrong.json"},
      stream:new Blob([bytes]).stream()}));
    expect(await verifyBackupReadback("backups/example.json","synthetic-private-token",digest)).toBe(false);
    expect(f.get).toHaveBeenCalledWith("backups/example.json",expect.objectContaining({access:"private",token:"synthetic-private-token"}));
  });
  it("protects both the newest DB and the last complete media pair, however old", async () => {
    const oldPair=db("old-complete","2026-07-01");
    const manifest:Artifact={id:"last-media",kind:"MEDIA_MANIFEST",state:"VERIFIED",
      pathname:oldPair.pathname+".media.json",databaseArtifactId:oldPair.id,createdAt:at("2026-07-02")};
    f.artifacts.push(oldPair,manifest,db("new-db","2026-10-25"),db("old-other","2026-07-03"));
    const removed=await pruneBackups(at("2026-10-25"),30,"synthetic-private-token");
    expect(removed).toBe(1);
    expect(f.del).toHaveBeenCalledWith("backups/2026-07-03-old-other.json",expect.any(Object));
    for(const a of [oldPair,manifest])expect(a.state).toBe("VERIFIED");
  });
  it("paginates 1,200 legacy objects without touching the known verified copy", async () => {
    const newest=db("newest","2026-10-25");
    f.artifacts.push(newest);
    const names=Array.from({length:1200},(_,i)=>"backups/2020-01-01-legacy-"+i+".json");
    f.list.mockImplementation(async ({cursor}:{cursor?:string})=>{
      const start=cursor?Number(cursor):0;
      return {blobs:names.slice(start,start+1000).map(pathname=>({pathname})),
        hasMore:start+1000<names.length,cursor:start+1000<names.length?String(start+1000):undefined};
    });
    const removed=await pruneBackups(at("2026-10-25"),30,"synthetic-private-token");
    expect(removed).toBe(1200);
    expect(f.del).toHaveBeenCalledTimes(1200);
    expect(f.del).not.toHaveBeenCalledWith(newest.pathname,expect.anything());
    expect(f.list).toHaveBeenCalledTimes(2);
  });
});
