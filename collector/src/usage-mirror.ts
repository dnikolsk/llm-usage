import {createHash} from 'node:crypto';
import {ingestSnapshot,type IngestSnapshot} from '@llm-usage/core';
import type {WorkerConfig} from './providers/types';

/** Send the same normalized telemetry to a separately hosted, write-only dashboard. */
export function createUsageMirror(config:WorkerConfig,options:{env?:NodeJS.ProcessEnv;fetch?:typeof fetch;warn?:(message:string)=>void}={}){
  const mirror=config.usage_mirror;
  if(!mirror)return async(_snapshot:IngestSnapshot)=>true;
  const service=new URL(mirror.service_url);
  if(service.username||service.password||service.search||service.hash||
    (service.protocol!=='https:'&&!(service.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(service.hostname))))throw new Error('usage_mirror_https_required');
  const env=options.env??process.env;
  const token=env[mirror.token_env];
  if(!token||token.length<32)throw new Error('usage_mirror_write_token_required');
  if(mirror.token_env===config.token_env||token===env[config.token_env])throw new Error('usage_mirror_independent_token_required');
  const configuredAccounts=new Set(config.targets.map(target=>target.account_id));
  if(Object.keys(mirror.account_ids).some(id=>!configuredAccounts.has(id)))throw new Error('usage_mirror_unknown_account');
  const destinations=[...configuredAccounts].map(id=>mirror.account_ids[id]??id);
  if(new Set(destinations).size!==destinations.length)throw new Error('usage_mirror_duplicate_account');
  const send=options.fetch??fetch;
  const warn=options.warn??console.error;
  return async(snapshot:IngestSnapshot)=>{
    try{
      const account=mirror.account_ids[snapshot.account_id]??snapshot.account_id;
      const body=JSON.stringify(ingestSnapshot.parse({...snapshot,account_id:account,
        limits:snapshot.limits.map(bucket=>({...bucket,account_id:account}))}));
      const key=createHash('sha256').update(body).digest('hex');
      const response=await send(new URL('/v1/ingest',service),{method:'POST',redirect:'error',
        headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':key},
        body,signal:AbortSignal.timeout(15000)});
      if(!response.ok){warn(`Dashboard usage publication failed: HTTP ${response.status}.`);return false;}
      const result=await response.json() as {result?:string};
      if(result.result!=='created'&&result.result!=='duplicate')throw new Error('invalid_acknowledgement');
      return true;
    }catch{
      // Never log server bodies, request headers, credentials, or provider responses.
      warn('Dashboard usage publication failed: connection or snapshot validation error.');return false;
    }
  };
}
