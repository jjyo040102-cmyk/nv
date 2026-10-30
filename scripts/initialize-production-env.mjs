import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const origin=process.argv[2];
if(!origin)throw new Error('Usage: node scripts/initialize-production-env.mjs https://your-domain.example');
const url=new URL(origin);
if(url.username||url.password||url.pathname!=='/'||url.hash||url.search||url.protocol!=='https:')throw new Error('Use the public HTTPS origin with no path.');
const content=[`ACTFLOW_PUBLIC_URL=${url.origin}`,'ACTFLOW_DEMO_AUTH=false','ACTFLOW_TEST_MODE=false','ACTFLOW_WORKER_ENABLED=true','ACTFLOW_DATA_DIR=./data/runtime','ACTFLOW_DB_PATH=./data/runtime/actflow.sqlite',`ACTFLOW_MASTER_KEY=${randomBytes(32).toString('hex')}`,'GOOGLE_CLIENT_ID=','GOOGLE_CLIENT_SECRET=','ACTFLOW_REAL_MAIL_ENABLED=false',''].join('\n');
try{await writeFile('.env.production.local',content,{flag:'wx',mode:0o600});console.log('Created private .env.production.local. Keep a secure backup of its encryption key. No secret was printed.');}
catch(error){if(error.code==='EEXIST')throw new Error('Existing production configuration was preserved. Edit it in place.');throw error;}
