import { describe,expect,it,vi,beforeEach } from "vitest";
const messageFindMany=vi.fn(),callFindMany=vi.fn();
vi.mock("@/lib/prisma",()=>({prisma:{
  communicationMessage:{findMany:(...a:unknown[])=>messageFindMany(...a)},
  callSession:{findMany:(...a:unknown[])=>callFindMany(...a)},
}}));
vi.mock("@/lib/session",()=>({requireRole:vi.fn()}));
import { getLinkedCommunicationRows } from "@/domains/messaging/context-timeline";
import { mergeTimelinePage,readTimelineCursor,timelineCursorWhere } from "@/domains/customers/timeline-page";
const stamp=new Date("2026-10-10T12:00:00Z");
const mk=(kind:"note"|"activity"|"message"|"call",n:number)=>({
  id:(kind==="note"?"note-":kind==="activity"?"audit-":kind==="message"?"message-":"call-")+String(n).padStart(3,"0"),
  kind,summary:kind,detail:null,authorName:null,createdAt:stamp,href:null,
});
describe("COM-L14A confirmed context and stable multi-source cursor",()=>{
  beforeEach(()=>{vi.resetAllMocks();messageFindMany.mockResolvedValue([]);callFindMany.mockResolvedValue([]);});
  it("uses deterministic source then ID ordering at equal times across page boundaries",()=>{
    const notes=Array.from({length:27},(_,i)=>mk("note",i));
    const a=mergeTimelinePage(notes,[mk("activity",5)],[mk("message",7)],[mk("call",3)]);
    expect(a.entries).toHaveLength(25);
    expect(a.entries[0].id).toBe("note-026");
    expect(a.nextCursor).not.toBeNull();
    const cursor=readTimelineCursor(a.nextCursor??undefined);
    expect(cursor).toMatchObject({kind:"note",id:"002"});
    const eq=timelineCursorWhere("activity",cursor);
    expect(eq.OR).toEqual(expect.arrayContaining([{createdAt:stamp}]));
    expect(timelineCursorWhere("note",cursor).OR).toEqual(
      expect.arrayContaining([{createdAt:stamp,id:{lt:"002"}}]));
    const page2=mergeTimelinePage([mk("note",0),mk("note",1)],[mk("activity",5)],
      [mk("message",7)],[mk("call",3)]);
    expect(page2.entries.map(x=>x.kind)).toEqual(["note","note","activity","message","call"]);
  });
  it("keeps cursor types strict and never treats an untrusted source as a timeline selector",()=>{
    const valid=Buffer.from(JSON.stringify({kind:"call",id:"abc123",createdAt:stamp.toISOString()})).toString("base64url");
    expect(readTimelineCursor(valid)).toMatchObject({kind:"call",id:"abc123"});
    const forged=Buffer.from(JSON.stringify({kind:"another",id:"abc123",createdAt:stamp.toISOString()})).toString("base64url");
    expect(readTimelineCursor(forged)).toBeNull();
    expect(readTimelineCursor("!!!")).toBeNull();
  });
  it("queries only confirmed same-record threads, not similarly numbered contacts",async()=>{
    const first=await getLinkedCommunicationRows("Customer","customer-1",null);
    expect(first.messages).toEqual([]);
    expect(messageFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where:{thread:{resolution:"RESOLVED",customerId:"customer-1"}},
      take:26,
    }));
    await getLinkedCommunicationRows("Lead","lead-2",{
      kind:"note",id:"abc",createdAt:stamp.toISOString(),
    });
    expect(callFindMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where:expect.objectContaining({
        thread:{resolution:"RESOLVED",leadId:"lead-2"},
      }),take:26,
    }));
  });
  it("labels accepted-but-unconfirmed, failed, inbound, missed and voicemail without message bodies",async()=>{
    messageFindMany.mockResolvedValue([
      {id:"m1",direction:"OUTBOUND",occurredAt:stamp,threadId:"t1",delivery:{state:"ACCEPTED"}},
      {id:"m2",direction:"INBOUND",occurredAt:stamp,threadId:"t1",delivery:null},
    ]);
    callFindMany.mockResolvedValue([
      {id:"c1",direction:"INBOUND",outcome:"MISSED",state:"ENDED",startedAt:stamp,threadId:"t1"},
      {id:"c2",direction:"INBOUND",outcome:"VOICEMAIL",state:"ENDED",startedAt:stamp,threadId:null},
    ]);
    const result=await getLinkedCommunicationRows("Customer","customer-1",null);
    expect(result.messages[0].detail).toContain("Acceptance is not delivery");
    expect(result.messages[1].summary).toBe("Incoming SMS");
    expect(result.messages[0].detail).not.toContain("suppressed");
    expect(result.calls.map(c=>c.summary)).toEqual(["Missed incoming call","Incoming voicemail"]);
    expect(result.calls[1].href).toBe("/desk/communications/calls/c2");
    expect(JSON.stringify(result)).not.toMatch(/bodyEncrypted|secret body|contactAddress/);
  });
});
