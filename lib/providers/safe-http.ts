import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ProviderConnectionError } from './errors';
import { NEBIUS_BASE_URL } from './presets';
const unbracket = (host: string): string => host.replace(/^\[|\]$/g, '');
export function isPublicAddress(address: string): boolean {
  if(isIP(address)===6) return /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:(?:0:|db8:|10:|2:)/i.test(address) && !/^2002:/i.test(address);
  if(isIP(address)!==4)return false;
  const [a,b,c]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
export function validateEndpoint(value: string): URL {
  if(typeof value!=='string'||value.length>1000)throw new Error('Invalid endpoint');
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!/^\/[A-Za-z0-9_/-]*$/.test(url.pathname)||!url.pathname.endsWith('/v1')&&url.pathname!=='/v1/')throw new Error('Invalid endpoint');
  url.pathname=url.pathname.replace(/\/$/,'');
  if(url.toString()!==NEBIUS_BASE_URL)throw new Error('Only the official Nebius Token Factory endpoint is supported');
  return url;
}
/** No redirects, no DNS rebinding, bounded body, absolute timeout, no response/key logging. */
export async function requestEndpointJson(baseUrl:string, path:'models'|'chat/completions', apiKey:string|undefined, body?:unknown, timeoutMs=60_000):Promise<unknown>{
  const startedAt=Date.now(),deadlineMs=Math.max(100,Math.min(timeoutMs,120_000));
  const base=validateEndpoint(baseUrl),target=new URL(`${base.toString().replace(/\/$/,'')}/${path}`);
  const hostname=unbracket(target.hostname);
  let address=hostname;
  {
    let dnsTimer:ReturnType<typeof setTimeout>|undefined;
    try {
      const results=await Promise.race([
        lookup(hostname,{all:true,verbatim:true}),
        new Promise<never>((_,reject)=>{dnsTimer=setTimeout(()=>reject(new Error('DNS timeout')),Math.min(deadlineMs,10_000));})
      ]);
      if(!results.length||results.some(r=>!isPublicAddress(r.address)))throw new Error('Address scope');
      address=results[0].address;
    }catch{throw new ProviderConnectionError('nebius','API 서버 주소를 안전하게 확인하지 못했습니다.');}
    finally{if(dnsTimer)clearTimeout(dnsTimer);}
  }
  if(apiKey&&(/[\r\n\0]/.test(apiKey)||apiKey.length>4096))throw new ProviderConnectionError('nebius','AI 인증 설정이 올바르지 않습니다.');
  const payload=body===undefined?undefined:Buffer.from(JSON.stringify(body));
  if(payload&&payload.length>4*1024*1024)throw new ProviderConnectionError('nebius','AI 요청이 허용 크기를 초과했습니다.');
  return new Promise((resolve,reject)=>{
    let settled=false;const finish=(error:Error|null,value?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
    const options:https.RequestOptions={protocol:target.protocol,hostname:address,port:target.port||undefined,servername:hostname,path:target.pathname,method:payload?'POST':'GET',agent:false,headers:{Host:target.host,Accept:'application/json',...(payload?{'Content-Type':'application/json','Content-Length':String(payload.length)}:{}),...(apiKey?{Authorization:`Bearer ${apiKey}`}:{})}};
    const request=https.request(options,response=>{
      response.once('error',()=>finish(new ProviderConnectionError('nebius')));
      const status=response.statusCode??0;
      if(status<200||status>=300){response.destroy();request.destroy();finish(new ProviderConnectionError('nebius',status===401||status===403?'AI 인증 키를 확인하세요.':status===404?'AI 모델 또는 API 경로를 찾을 수 없습니다.':'AI 서버 요청이 실패했습니다.'));return;}
      let bytes=0;const chunks:Buffer[]=[];
      response.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>2*1024*1024){request.destroy();response.destroy();finish(new ProviderConnectionError('nebius','AI 응답이 허용 크기를 초과했습니다.'));}else chunks.push(chunk);});
      response.once('error',()=>finish(new ProviderConnectionError('nebius')));
      response.once('end',()=>{try{finish(null,JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{finish(new ProviderConnectionError('nebius','AI 서버가 올바른 JSON을 반환하지 않았습니다.'));}});
    });
    const timer=setTimeout(()=>{request.destroy();finish(new ProviderConnectionError('nebius','AI 서버 응답 시간이 초과되었습니다.'));},Math.max(1,deadlineMs-(Date.now()-startedAt)));
    request.once('error',()=>finish(new ProviderConnectionError('nebius')));
    request.end(payload);
  });
}
