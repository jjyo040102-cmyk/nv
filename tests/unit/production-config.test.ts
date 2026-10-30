import {expect,it} from 'vitest';
import {assertProductionConfig} from '../../lib/config/production';
import {readJson} from '../../lib/api/schemas';
const production={NODE_ENV:'production',ACTFLOW_DEMO_AUTH:'false',ACTFLOW_MASTER_KEY:'1'.repeat(64),ACTFLOW_PUBLIC_URL:'https://actflow.example'};
it('fails closed for shared demo auth, missing encryption, test fixtures and insecure public origins',()=>{
  expect(()=>assertProductionConfig(production)).not.toThrow();
  for(const patch of [{ACTFLOW_DEMO_AUTH:'true'},{ACTFLOW_DEMO_AUTH:undefined},{ACTFLOW_MASTER_KEY:''},{ACTFLOW_TEST_MODE:'true'},{ACTFLOW_PUBLIC_URL:'http://public.example'},{ACTFLOW_PUBLIC_URL:'https://user:password@example.com'}])expect(()=>assertProductionConfig({...production,...patch})).toThrow();
});
it('bounds JSON streams even without Content-Length',async()=>{
  await expect(readJson(new Request('http://localhost',{method:'POST',body:JSON.stringify({large:'x'.repeat(1024*1024)})}))).rejects.toMatchObject({status:413});
  await expect(readJson(new Request('http://localhost',{method:'POST',body:'{"ok":true}'}))).resolves.toEqual({ok:true});
});
