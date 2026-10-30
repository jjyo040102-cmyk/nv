import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {openDatabase} from '../lib/db';
import {runMigrations} from '../lib/db/migrate';
import {AccountService} from '../lib/auth/accounts';
const root=resolve(`data/runtime/production-smoke-${Date.now()}`),port=3188,origin=`http://127.0.0.1:${port}`;
await mkdir(root,{recursive:true});
const config={dataDir:root,dbPath:resolve(root,'actflow.sqlite'),demoAuth:false,maxUploadMb:25};
const db=openDatabase(config);runMigrations(db);
const password=randomBytes(24).toString('base64url');await new AccountService(db).create({username:'smoke-owner',password});db.close();
const environment:NodeJS.ProcessEnv={...process.env,NODE_ENV:'production',ACTFLOW_DEMO_AUTH:'false',ACTFLOW_TEST_MODE:'false',ACTFLOW_WORKER_ENABLED:'true',ACTFLOW_REAL_MAIL_ENABLED:'false',ACTFLOW_PUBLIC_URL:origin,ACTFLOW_MASTER_KEY:randomBytes(32).toString('hex'),ACTFLOW_DATA_DIR:root,ACTFLOW_DB_PATH:config.dbPath,GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',NEBIUS_API_KEY:'',NEXT_TELEMETRY_DISABLED:'1'};
let child:ChildProcess|undefined,logs='',cookie='';
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function start(){
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:process.cwd(),env:environment,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout?.on('data',data=>{logs+=String(data);});child.stderr?.on('data',data=>{logs+=String(data);});
  for(let i=0;i<90;i++){if(child.exitCode!==null)throw new Error(`Production server exited: ${logs.slice(-2000)}`);try{if((await fetch(origin+'/api/health')).ok)return;}catch{}await sleep(500);}
  throw new Error('Production start timed out');
}
async function stop(){if(child&&child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}}
async function request(path:string,body?:unknown,method=body===undefined?'GET':'POST'){
  return fetch(origin+path,{method,headers:{'content-type':'application/json',origin,cookie},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
}
try{
  await start();assert.equal((await request('/api/tasks')).status,401);
  cookie='actflow_session=forged';assert.equal((await request('/api/settings')).status,401);assert.equal((await request('/settings')).status,307);cookie='';
  const login=await request('/api/auth/login',{username:'smoke-owner',password});assert.equal(login.status,200);cookie=login.headers.get('set-cookie')!.split(';')[0];
  assert.match(login.headers.get('set-cookie')!,/HttpOnly/);
  const settings=await request('/api/settings');assert.equal(settings.status,200);
  const forged=await fetch(origin+'/api/tasks',{method:'POST',headers:{cookie,origin:'https://other.example','content-type':'application/json'},body:'{}'});assert.equal(forged.status,403);
  const fixture=await request('/api/providers',{providerId:'demo',model:'actflow-demo-v1'});assert.equal(fixture.status,400);
  const created=await request('/api/tasks',{title:'Persisted production smoke task',goal:'Verify persistence and timed wake without real inference',backgroundWatchEnabled:true});assert.equal(created.status,201);
  const {task}=await created.json();assert.ok(task.id);
  const due=new Date(Date.now()+1500).toISOString();assert.equal((await request(`/api/tasks/${task.id}/triggers`,{type:'TIME',config:{},nextDueAt:due})).status,201);
  console.log('Production auth, CSRF, fixture rejection and task creation passed. Waiting for the persisted worker tick.');
  let observed=false;
  for(let i=0;i<50;i++){await sleep(1000);const data=await (await request(`/api/tasks/${task.id}/events`)).json();if(data.events.some((event:{type:string;status:string})=>event.type==='TIME'&&['PROCESSED','FAILED'].includes(event.status))){observed=true;break;}}
  assert.equal(observed,true,'Background worker must process the timer without a browser.');
  const readiness=await (await request('/api/readiness')).json();assert.equal(readiness.worker.healthy,true);assert.equal(readiness.inference.credentialSaved,false);
  await stop();await start();const persisted=await request(`/api/tasks/${task.id}`);assert.equal(persisted.status,200);assert.equal((await persisted.json()).task.id,task.id);
  assert.equal((await request('/api/auth/logout',{})).status,200);assert.equal((await request('/api/tasks')).status,401);
  const browserFlowTested=process.argv.includes('--browser');
  if(browserFlowTested){
    const {chromium,expect}=await import('@playwright/test');
    const browser=await chromium.launch();
    try{
      const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(origin+'/');await expect(page).toHaveURL(origin+'/login');
      await page.screenshot({path:resolve(root,'login.png'),caret:'initial'});
      await page.getByLabel('아이디',{exact:true}).fill('smoke-owner');
      await page.getByLabel('비밀번호',{exact:true}).fill(password);
      await page.getByRole('button',{name:'로그인',exact:true}).click();
      await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();
      await expect(page.getByRole('link',{name:/Persisted production smoke task/})).toBeVisible();
      await expect(page.getByRole('navigation',{name:'주 메뉴'}).getByRole('link')).toHaveCount(3);
      await expect(page.getByRole('group',{name:'작업 상태 필터'}).getByRole('button',{name:/확인 필요\s*1/})).toBeVisible();
      await page.screenshot({path:resolve(root,'desktop.png'),caret:'initial'});
      await page.setViewportSize({width:390,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);
      assert.equal(await page.locator('.task-card-main p').evaluate(element=>element.getBoundingClientRect().right<=element.closest('.task-card')!.getBoundingClientRect().right),true);
      await page.screenshot({path:resolve(root,'mobile.png'),fullPage:true,caret:'initial'});
      await page.getByRole('button',{name:'로그아웃',exact:true}).click();await expect(page).toHaveURL(origin+'/login');
      assert.equal((await page.request.get(origin+'/api/tasks')).status(),401);
      await page.goto(origin+'/settings');await expect(page).toHaveURL(origin+'/login');
      assert.deepEqual(errors,[]);
    }finally{await browser.close();}
  }
  await writeFile(resolve(root,'result.json'),JSON.stringify({passed:true,checks:['production account authentication','forged cookie rejected','cross-origin mutation rejected','no production demo model','task and session survive restart','timed worker runs without browser','logout revokes persisted session'],browserFlowTested,realNebiusCalled:false,realGmailCalled:false,createdAt:new Date().toISOString()},null,2));
  console.log(`Production smoke passed. Evidence: ${root}/result.json`);
}finally{await stop();await writeFile(resolve(root,'server.log'),logs);}
