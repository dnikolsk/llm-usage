import {readFile} from 'node:fs/promises';
import {workerConfig} from './providers/types';
const config=workerConfig.parse(JSON.parse(await readFile(process.argv[2]??'','utf8')));
const url=new URL(config.service_url);
if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('https_required');
const token=process.env.ADMIN_TOKEN;if(!token||token.length<32)throw new Error('ADMIN_TOKEN is required');
async function post(path:string,body:unknown){
 const r=await fetch(new URL('/v1/execution/'+path,url),{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new Error(`Registration failed: ${path} (${r.status})`);
}
for(const target of config.targets){
 await post('accounts',{id:target.account_id,provider:target.provider,label:target.label??target.account_id,account_type:target.account_type});
 await post('targets',{id:target.id,account_id:target.account_id,worker_id:config.worker_id,mode:target.mode,repositories:Object.keys(target.repositories),
  model_classes:Object.keys(target.models),setup_minutes:target.setup_minutes,billing:target.billing});
 console.log(`Registered ${target.account_id}: ${target.id}. Login and billing readiness are checked separately.`);
}
