import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {ingestSnapshot} from '@llm-usage/core';
import type {Target} from '../types';
import {usageJson} from '../usage-http';
const bucket=z.object({utilization:z.number().finite().nonnegative(),resets_at:z.iso.datetime({offset:true}).nullable()});
export function normalizeUsage(raw:unknown,accountId:string,now=new Date()){
  const data=z.record(z.string(),z.unknown()).parse(raw);
  const observed=now.toISOString();
  const definitions=[['five_hour','session','all_models',18000],['seven_day','weekly','all_models',604800],
    ['seven_day_opus','weekly','opus',604800],['seven_day_sonnet','weekly','sonnet',604800],
    ['seven_day_oauth_apps','weekly','oauth_apps',604800],['seven_day_cowork','weekly','cowork',604800]] as const;
  const limits=definitions.flatMap(([id,kind,scope,window_seconds])=>{
    if(data[id]==null)return[];
    const b=bucket.parse(data[id]);const used=Math.min(1,b.utilization/100);
    return[{id,account_id:accountId,kind,scope,unit:'fraction',window_seconds,used_fraction:used,remaining_fraction:1-used,
      observed_at:observed,reset_at:b.resets_at===null?null:new Date(b.resets_at).toISOString(),source:'local_collector',confidence:'provider_reported'}];
  });
  if(!limits.some(b=>b.scope==='all_models'))throw new Error('usage_schema_unrecognized');
  // Extra usage is separately billed and must never expand included capacity.
  return{allowed:null,snapshot:ingestSnapshot.parse({account_id:accountId,provider:'anthropic',observed_at:observed,
    status:data.five_hour!=null&&data.seven_day!=null?'ok':'partial',limits,metadata:{adapter_version:'claude-oauth-v1'}})};
}
export async function readUsage(target:Target){
  const credentials=z.object({claudeAiOauth:z.object({accessToken:z.string().min(1),expiresAt:z.number().optional()})})
    .parse(JSON.parse(await readFile(join(target.auth_dir,'.credentials.json'),'utf8'))).claudeAiOauth;
  if(credentials.expiresAt!==undefined&&credentials.expiresAt<=Date.now())throw new Error('usage_auth_required');
  const raw=await usageJson('https://api.anthropic.com/api/oauth/usage',{headers:{Authorization:`Bearer ${credentials.accessToken}`,'anthropic-beta':'oauth-2025-04-20'}});
  return normalizeUsage(raw,target.account_id);
}
