import {describe,expect,it} from "vitest";
import JSZip from "jszip";
import {DataGuard} from "../../lib/security/data-guard";

describe("data egress guard",()=>{
  it("blocks cross-owner data",async()=>{
    const d=await new DataGuard().evaluateOutgoing({ownerSessionId:"a",recipient:"x@example.com",verifiedRecipient:true,items:[{name:"x.txt",sourceOwnerSessionId:"b",sourceProjectId:"p",classification:"PUBLIC",text:"hello"}]});
    expect(d.decision).toBe("BLOCK");
  });

  it("requires approval for broad external export even with obfuscated request text",async()=>{
    const d=await new DataGuard().evaluateOutgoing({ownerSessionId:"a",recipient:"x@example.com",verifiedRecipient:true,bulkExport:true,items:Array.from({length:20},(_,i)=>({name:`${i}.txt`,sourceOwnerSessionId:"a",sourceProjectId:"p",classification:"PUBLIC" as const,text:"ok"}))});
    expect(d.decision).toBe("REQUIRE_APPROVAL");
  });

  it("counts files inside one ZIP as a bulk export instead of treating the archive as one attachment",async()=>{
    const zip=new JSZip();
    for(let i=0;i<20;i++)zip.file(`file-${i}.txt`,`safe ${i}`);
    const buffer=await zip.generateAsync({type:"nodebuffer"});
    const d=await new DataGuard().evaluateOutgoing({ownerSessionId:"a",recipient:"x@example.com",verifiedRecipient:true,items:[{name:"bundle.zip",sourceOwnerSessionId:"a",sourceProjectId:"p",classification:"PUBLIC",buffer,contentType:"application/zip"}]});
    expect(d.decision).toBe("REQUIRE_APPROVAL");
    expect(d.reasons).toContain("BULK_EXPORT");
  });

  it("blocks secrets",async()=>{
    const d=await new DataGuard().evaluateOutgoing({ownerSessionId:"a",recipient:"x@example.com",verifiedRecipient:true,items:[{name:".env",sourceOwnerSessionId:"a",sourceProjectId:"p",classification:"INTERNAL",text:"API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456"}]});
    expect(d.decision).toBe("BLOCK");
  });

  it("hard-blocks unreadable archives rather than allowing a human to override an unscannable payload",async()=>{
    const d=await new DataGuard().evaluateOutgoing({ownerSessionId:"a",recipient:"x@example.com",verifiedRecipient:true,items:[{name:"broken.zip",sourceOwnerSessionId:"a",sourceProjectId:"p",classification:"PUBLIC",buffer:Buffer.from("not-a-zip"),contentType:"application/zip"}]});
    expect(d.decision).toBe("BLOCK");
    expect(d.reasons).toContain("ARCHIVE_UNREADABLE_OR_ENCRYPTED");
  });
});
