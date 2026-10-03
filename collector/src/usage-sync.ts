import {readFile} from 'node:fs/promises';
import {workerConfig} from './providers/types';
import {collectUsage} from './usage';
import {createUsageMirror} from './usage-mirror';
const config=workerConfig.parse(JSON.parse(await readFile(process.argv[2]??'','utf8')));
const url=new URL(config.service_url);
if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('https_required');
const token=process.env[config.token_env];if(!token||token.length<32)throw new Error('worker_token_required');
const mirrorUsage=createUsageMirror(config);
const seen=new Set<string>();
for(const target of config.targets){
  if(seen.has(target.account_id))continue;seen.add(target.account_id);
  const{snapshot}=await collectUsage(target);
  const response=await fetch(new URL('/v1/execution/worker/usage',url),{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'X-Worker-Id':config.worker_id,'Content-Type':'application/json'},body:JSON.stringify(snapshot),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`usage_publish_failed_${response.status}`);
  if(!await mirrorUsage(snapshot))process.exitCode=1;
  console.log(JSON.stringify(snapshot));
  if(snapshot.status==='error')process.exitCode=1;
}
