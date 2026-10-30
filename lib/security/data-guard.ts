import {scanArchive,isZipContent} from "./archive-scanner";
import {scanSecrets,type SecretFinding} from "./secret-scanner";

export type DataClassification="PUBLIC"|"INTERNAL"|"CONFIDENTIAL"|"RESTRICTED";
export type OutgoingItem={artifactId?:string;name:string;sourceOwnerSessionId:string;sourceProjectId?:string|null;classification:DataClassification;text?:string;buffer?:Buffer;contentType?:string};
export type DataGuardDecision={decision:"ALLOW"|"REQUIRE_APPROVAL"|"BLOCK";reasons:string[];secretFindings:Array<SecretFinding&{item:string}>};

const hardBlockReasons=new Set([
  "CROSS_OWNER_DATA","CROSS_PROJECT_DATA","RESTRICTED_DATA","SECRET_DETECTED","UNSCANNABLE_ATTACHMENT","ARCHIVE_PATH_TRAVERSAL","ARCHIVE_MAX_DEPTH",
  "ARCHIVE_FILE_LIMIT","ARCHIVE_EXPANDED_SIZE_LIMIT","ARCHIVE_UNREADABLE_OR_ENCRYPTED","ARCHIVE_ENTRY_UNREADABLE",
  "ARCHIVE_LIMIT","SECRET_IN_ARCHIVE"
]);

export class DataGuard{
  async evaluateOutgoing(input:{ownerSessionId:string;recipient:string;verifiedRecipient:boolean;items:OutgoingItem[];bulkExport?:boolean;allowedProjectId?:string|null}):Promise<DataGuardDecision>{
    const reasons:string[]=[];
    const findings:Array<SecretFinding&{item:string}>=[];
    let exportedFileCount=input.items.length;
    if(!input.recipient.trim())reasons.push("RECIPIENT_MISSING");
    if(input.items.some(i=>i.sourceOwnerSessionId!==input.ownerSessionId))reasons.push("CROSS_OWNER_DATA");
    const projects=new Set(input.items.map(i=>i.sourceProjectId).filter(Boolean));
    if(input.allowedProjectId!==undefined&&[...projects].some(p=>p!==input.allowedProjectId))reasons.push("CROSS_PROJECT_DATA");
    else if(projects.size>1)reasons.push("CROSS_PROJECT_DATA");
    if(input.items.some(i=>i.classification==="RESTRICTED"))reasons.push("RESTRICTED_DATA");
    if(input.items.some(i=>i.classification==="CONFIDENTIAL"))reasons.push("CONFIDENTIAL_EXTERNAL");
    if(!input.verifiedRecipient)reasons.push("RECIPIENT_NOT_VERIFIED");

    for(const item of input.items){
      if(item.text)for(const f of scanSecrets(item.text))findings.push({...f,item:item.name});
      if(!item.buffer)continue;
      if(/\.(?:7z|rar|tar|gz|bz2|xz)$/i.test(item.name))reasons.push("ARCHIVE_UNSUPPORTED_FORMAT");
      if(isZipContent(item.buffer)||/zip/i.test(item.contentType??"")||/\.(?:zip|docx|xlsx|pptx|jar|odt|ods)$/i.test(item.name)){
        const result=await scanArchive(item.buffer);
        // The archive itself was already counted as one outgoing item. Count its contents instead.
        exportedFileCount+=Math.max(0,result.fileCount-1);
        if(!result.safe)reasons.push(result.blockedReason??"UNSAFE_ARCHIVE");
        for(const f of result.secretFindings)findings.push({...f,item:`${item.name}:${f.path}`});
      }else{
        // Do not treat compressed/opaque bytes as clean UTF-8. Only text and inspected ZIP/OOXML are exportable.
        try {
          const bom=item.buffer.subarray(0,2).toString('hex');
          const decoded=new TextDecoder(bom==='fffe'?'utf-16le':bom==='feff'?'utf-16be':'utf-8',{fatal:true}).decode(item.buffer);
          if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(decoded)||decoded.startsWith('%PDF-'))reasons.push('UNSCANNABLE_ATTACHMENT');
          else for(const f of scanSecrets(decoded))findings.push({...f,item:item.name});
        } catch { reasons.push('UNSCANNABLE_ATTACHMENT'); }
      }
    }
    if(input.bulkExport||exportedFileCount>=20)reasons.push("BULK_EXPORT");
    if(findings.length)reasons.push("SECRET_DETECTED");
    const unique=[...new Set(reasons)];
    if(unique.some(r=>hardBlockReasons.has(r)||r.startsWith("ARCHIVE_")||r==="UNSAFE_ARCHIVE"))return {decision:"BLOCK",reasons:unique,secretFindings:findings};
    if(unique.length)return {decision:"REQUIRE_APPROVAL",reasons:unique,secretFindings:findings};
    return {decision:"ALLOW",reasons:[],secretFindings:[]};
  }
}
