import {z} from 'zod';
import {ingestSnapshot} from '@llm-usage/core';
import type {Target} from '../types';
import {usageJson} from '../usage-http';
import {accessToken} from './session';
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
  // Display monthly extra-usage budget separately; it is not purchased-token inventory.
  const extra=z.object({is_enabled:z.boolean(),monthly_limit:z.number().finite().nonnegative().nullable().optional(),used_credits:z.number().finite().nonnegative().nullable().optional()}).safeParse(data.extra_usage);
  const paid=extra.success?[{id:'extra_usage',label:'Extra usage budget',kind:'spending_limit',unit:'usd_cents',
    enabled:extra.data.is_enabled,limit:extra.data.monthly_limit??null,used:extra.data.used_credits??null,
    remaining:extra.data.monthly_limit!=null&&extra.data.used_credits!=null?Math.max(0,extra.data.monthly_limit-extra.data.used_credits):null,
    observed_at:observed,reset_at:null}]:[];
  // No calendar reset is invented; extra usage never expands included capacity.
  return{allowed:null,snapshot:ingestSnapshot.parse({account_id:accountId,provider:'anthropic',observed_at:observed,
    status:data.five_hour!=null&&data.seven_day!=null?'ok':'partial',limits,metadata:{adapter_version:'claude-oauth-v2',paid_usage:paid,...(data.extra_usage!=null&&!extra.success?{paid_usage_diagnostic:'paid_usage_schema_unrecognized'}:{})}})};
}
export async function readUsage(target:Target){
  const session=await accessToken(target.auth_dir);
  const raw=await usageJson('https://api.anthropic.com/api/oauth/usage',{headers:{Authorization:`Bearer ${session.token}`,'anthropic-beta':'oauth-2025-04-20'}});
  return normalizeUsage(raw,target.account_id);
}
