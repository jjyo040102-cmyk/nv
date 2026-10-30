import '../lib/config/load-env';
import {mkdir,cp,writeFile,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {readConfig} from '../lib/config';
import {openDatabase} from '../lib/db';
// Take the service offline to keep the artifact directory and database at one logical point.
if(!process.argv.includes('--service-stopped'))throw new Error('Stop ActFlow before backing up, then pass --service-stopped.');
const output=process.argv[process.argv.indexOf('--output')+1];
if(!process.argv.includes('--output')||!output)throw new Error('Provide --output PATH outside ACTFLOW_DATA_DIR.');
const config=readConfig(process.env),source=await realpath(resolve(config.dataDir)),target=resolve(output),part=relative(source,target);
if(!part||(!part.startsWith('..'+sep)&&part!=='..'&&!isAbsolute(part)))throw new Error('Backup output must be outside the active data directory.');
await mkdir(target,{recursive:false,mode:0o700});
await cp(source,resolve(target,'data'),{recursive:true,dereference:false,filter:(name)=>!/\.sqlite(?:-wal|-shm)?$/.test(name)});
const db=openDatabase(config);
try{await db.backup(resolve(target,'actflow.sqlite'));}finally{db.close();}
await writeFile(resolve(target,'RESTORE.txt'),'Stop ActFlow. Restore data/ into ACTFLOW_DATA_DIR and actflow.sqlite into ACTFLOW_DB_PATH. Restore the matching private ACTFLOW_MASTER_KEY separately. Keep permissions private; start one instance.\n');
console.log('Backup complete. Store the matching encryption key separately; this archive contains private workspace data.');
