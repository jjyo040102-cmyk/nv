import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../../lib/db/migrate";
import { GmailConnection } from "../../lib/email/gmail-connection";
import { GmailClient, createMime, type GmailMessage } from "../../lib/email/gmail-client";
import type { GoogleRequest } from "../../lib/email/google-http";
import type { MailDraft } from "../../lib/email/types";
const databases: Database.Database[] = [];
beforeEach(() => { vi.stubEnv("GOOGLE_CLIENT_ID", "test-client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "private-client-secret"); vi.stubEnv("ACTFLOW_PUBLIC_URL", "http://localhost:3000"); });
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.unstubAllEnvs(); });
function setup() { const db = new Database(":memory:"); databases.push(db); runMigrations(db); return db; }
const tokenResult = { access_token: "test-access-token", refresh_token: "test-refresh-token", token_type: "Bearer", expires_in: 3600, scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send" };
describe("Gmail connection", () => {
  it("binds a single-use OAuth state to actor and workspace; stores only encrypted tokens", async () => {
    const db = setup(), calls: string[] = [];
    const http: GoogleRequest = async <T>(url: string) => { calls.push(url); return (url.includes("/token") ? tokenResult : { emailAddress: "owner@example.com" }) as T; };
    const connection = new GmailConnection(db, "1".repeat(64), http), url = new URL(connection.begin("workspace-a", "user-a")), state = url.searchParams.get("state")!;
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    await expect(connection.finish("workspace-b", "user-a", state, "code")).rejects.toThrow(/만료/);
    expect(calls).toHaveLength(0);
    await connection.finish("workspace-a", "user-a", state, "code");
    expect(await connection.accessToken("workspace-a")).toBe("test-access-token");
    const stored = JSON.stringify(db.prepare("SELECT * FROM gmail_connections").all());
    expect(stored).not.toContain("test-access-token"); expect(stored).not.toContain("test-refresh-token");
    expect(connection.status("workspace-a").email).toBe("owner@example.com");
    await expect(connection.finish("workspace-a", "user-a", state, "code")).rejects.toThrow(/만료/);
    connection.disconnect("workspace-a"); await expect(connection.accessToken("workspace-a")).rejects.toThrow(/연결/);
  });
  it("rejects grants without the required read/send scopes", async () => {
    const db=setup(),http=(async()=>({...tokenResult,scope:"https://www.googleapis.com/auth/gmail.send"})) as GoogleRequest;
    const connection=new GmailConnection(db,"2".repeat(64),http),state=new URL(connection.begin("owner","user")).searchParams.get("state")!;
    await expect(connection.finish("owner","user",state,"code")).rejects.toThrow(/권한/);
    expect(connection.status("owner").connected).toBe(false);
  });
});
const draft: MailDraft={ownerSessionId:"owner",inboundMessageId:"gmail:incoming",idempotencyKey:"a-repeat-proof-key",to:"partner@example.com",subject:"Re: Training",body:"Confirmed\n2 participants",threadId:"thread1",attachments:[{name:"roster.xlsx",contentType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",bytes:Buffer.from("verified-bytes")}]};
function sentMessage(): GmailMessage { return {id:"sent1",threadId:"thread1",labelIds:["SENT"],payload:{mimeType:"multipart/mixed",headers:[{name:"From",value:"owner@example.com"},{name:"To",value:draft.to},{name:"Subject",value:draft.subject},{name:"Message-ID",value:`<${draft.idempotencyKey}@actflow.invalid>`}],parts:[{mimeType:"text/plain",body:{data:Buffer.from(draft.body).toString("base64url")}},{mimeType:draft.attachments![0].contentType,filename:"roster.xlsx",body:{data:Buffer.from("verified-bytes").toString("base64url")}}]}}; }
const connection={accessToken:async()=>"token",email:()=>"owner@example.com"} as unknown as GmailConnection;
describe("verified Gmail delivery",()=>{
  it("requires a SENT readback with exact content and attachments",async()=>{
    const requests:Array<{url:string;method?:string}>=[];
    const http:GoogleRequest=async<T>(url:string,init?:RequestInit)=>{requests.push({url,method:init?.method});return (url.includes("/messages/send")?{id:"sent1"}:url.includes("/messages/incoming")?{id:"incoming",threadId:"thread1",payload:{headers:[{name:"Subject",value:"Training"},{name:"From",value:draft.to},{name:"Message-ID",value:"<original@example.com>"}]}}:url.includes("/messages/sent1")?sentMessage():{messages:[]}) as T;};
    const result=await new GmailClient(connection,http).sendDraft(draft);
    expect(result).toMatchObject({externalEffect:"ACTUAL",remoteVerified:true,messageId:"sent1"});
    expect(requests.filter(request=>request.method==="POST")).toHaveLength(1);
    expect(requests.at(-1)!.url).toContain("/messages/sent1?format=full");
  });
  it("reconciles an existing idempotent result without sending again",async()=>{
    const methods:string[]=[];const http:GoogleRequest=async<T>(url:string,init?:RequestInit)=>{methods.push(init?.method??"GET");return (url.includes("/messages/sent1")?sentMessage():{messages:[{id:"sent1"}]}) as T;};
    await expect(new GmailClient(connection,http).sendDraft(draft)).resolves.toMatchObject({remoteVerified:true});
    expect(methods).not.toContain("POST");
  });
  it.each(["recipient","body","attachment","label"])("rejects changed %s after an apparently successful send",async(fault)=>{
    const message=sentMessage();if(fault==="recipient")message.payload.headers![1].value="wrong@example.com";
    if(fault==="body")message.payload.parts![0].body!.data=Buffer.from("wrong").toString("base64url");
    if(fault==="attachment")message.payload.parts![1].body!.data=Buffer.from("modified").toString("base64url");
    if(fault==="label")message.labelIds=[];
    const http=(async()=>message) as GoogleRequest;await expect(new GmailClient(connection,http).verify("owner","sent1",draft)).rejects.toThrow();
  });
  it("rejects header injection and never promotes Gmail provenance to sender authentication",()=>{
    expect(()=>createMime({...draft,subject:"hello\r\nBcc: attacker@example.com"},"owner@example.com",null)).toThrow();
    const message=sentMessage();message.payload.headers![0].value="partner@example.com";
    expect(new GmailClient(connection).envelope(message).auth).toMatchObject({trustedAdapter:true,status:"MISSING",dmarc:"MISSING"});
  });
});
