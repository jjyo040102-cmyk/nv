import {describe,expect,it} from 'vitest';
import JSZip from 'jszip';
import {scanSecrets} from '../../lib/security/secret-scanner';
import {scanArchive} from '../../lib/security/archive-scanner';
import {DataGuard} from '../../lib/security/data-guard';
import {normalizeEmailAddress,normalizeEmailEnvelope} from '../../lib/events/email-normalizer';

describe('release security regressions',()=>{
  it('does not exempt an actual credential containing a placeholder word',()=>{
    expect(scanSecrets('sk-EXAMPLEabcdefghijklmnopqrstuvwxyz123456').length).toBeGreaterThan(0);
    expect(scanSecrets('TOKEN=REDACTED')).toHaveLength(0);
  });
  it('never includes credential material in a finding preview',()=>{
    const token='sk-abcdefghijklmnopqrstuvwxyz123456';
    const findings=scanSecrets(token);expect(findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(findings)).not.toContain('sk-abc');
  });
  it.each(['{"password":"correct-horse-battery"}','postgres://alice:secretpass@db.example/test','Authorization: Bearer abcdefghijklmnopqrstuvwxyz'])('detects secret formats: %s',text=>expect(scanSecrets(text).length).toBeGreaterThan(0));
  it('inspects raw archive names before a library sanitizes traversal',async()=>{
    const z=new JSZip();z.file('../escape.txt','safe');
    const result=await scanArchive(await z.generateAsync({type:'nodebuffer'}));
    expect(result.safe).toBe(false);expect(result.blockedReason).toBe('ARCHIVE_PATH_TRAVERSAL');
  });
  it('blocks advertised expanded sizes before inflating',async()=>{
    const z=new JSZip();z.file('big.txt','x'.repeat(100_000));
    const result=await scanArchive(await z.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),{maxUncompressedBytes:1024});
    expect(result.safe).toBe(false);expect(result.uncompressedBytes).toBeLessThanOrEqual(1024);
  });
  it('scans extensionless entries and ZIP content disguised as a binary',async()=>{
    const inner=new JSZip();inner.file('private.pem','-----BEGIN PRIVATE KEY-----');
    const outer=new JSZip();outer.file('payload.dat',await inner.generateAsync({type:'nodebuffer'}));
    const result=await scanArchive(await outer.generateAsync({type:'nodebuffer'}));
    expect(result.safe).toBe(false);expect(result.secretFindings.length).toBeGreaterThan(0);
  });
  it('hard-blocks explicit cross-project egress, including a project into an unscoped task',async()=>{
    for(const allowedProjectId of ['project-a',null]){
      const result=await new DataGuard().evaluateOutgoing({ownerSessionId:'owner',recipient:'safe@example.com',verifiedRecipient:true,allowedProjectId,items:[{name:'a.txt',sourceOwnerSessionId:'owner',sourceProjectId:'project-b',classification:'PUBLIC',text:'safe'}]});
      expect(result.decision).toBe('BLOCK');expect(result.reasons).toContain('CROSS_PROJECT_DATA');
    }
  });
  it.each(['one@example.com, two@example.com','one@example.com <two@example.com> <three@example.com>','a@b@example.com','good@example.com\r\nBcc: bad@example.com'])('rejects ambiguous/header-injection mailboxes: %s',address=>expect(()=>normalizeEmailAddress(address)).toThrow());
  it('preserves every address character after mailbox parsing',()=>expect(normalizeEmailAddress('Name <User+tag@EXAMPLE.COM>')).toBe('User+tag@EXAMPLE.COM'));
  it('rejects empty message identity',()=>expect(()=>normalizeEmailEnvelope({from:'a@example.com',messageId:' '})).toThrow());
});
