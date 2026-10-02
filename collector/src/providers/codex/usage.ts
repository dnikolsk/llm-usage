import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { ingestSnapshot } from '@llm-usage/core';
import { providerEnvironment, type Target } from '../types';
const windowSchema=z.object({usedPercent:z.number().min(0).max(100),windowDurationMins:z.number().int().positive().nullable(),resetsAt:z.number().int().nonnegative().nullable()});
const limits=z.object({limitId:z.string().nullable().optional(),normalModelSlug:z.string().nullable().optional(),
  primary:windowSchema.nullable(),secondary:windowSchema.nullable(),spendControlReached:z.boolean().nullable().optional()});
const responseSchema=z.object({ordinaryUsageAllowed:z.boolean().nullable().optional(),rateLimits:limits.nullable(),
  rateLimitsByLimitId:z.record(z.string(),limits).nullable().optional()});
export function normalizeUsage(raw:unknown,accountId:string,now=new Date()){
  const data=responseSchema.parse(raw);
  const snapshots=data.rateLimitsByLimitId&&Object.keys(data.rateLimitsByLimitId).length?Object.entries(data.rateLimitsByLimitId):data.rateLimits?[['codex',data.rateLimits] as const]:[];
  const observed=now.toISOString();
  const buckets=snapshots.flatMap(([id,snapshot])=>Object.entries({primary:snapshot.primary,secondary:snapshot.secondary}).flatMap(([window,b])=>{
    if(!b)return[];
    const kind=b.windowDurationMins===10080?'weekly':b.windowDurationMins===300?'session':`window_${b.windowDurationMins??window}`;
    return [{id:`${id}-${window}`,account_id:accountId,kind,scope:snapshot.normalModelSlug??'all_models',unit:'fraction',
      used_fraction:b.usedPercent/100,remaining_fraction:1-b.usedPercent/100,
      window_seconds:b.windowDurationMins===null?null:b.windowDurationMins*60,
      observed_at:observed,reset_at:b.resetsAt===null?null:new Date(b.resetsAt*1000).toISOString(),source:'official_api',confidence:'provider_reported'}];
  }));
  return {allowed:data.ordinaryUsageAllowed??null,
    snapshot:ingestSnapshot.parse({account_id:accountId,provider:'openai',observed_at:observed,status:'ok',limits:buckets,metadata:{adapter_version:'codex-0.159.3'}})};
}
/** Query the official CLI app-server; no OAuth token extraction or private endpoint calls. */
export function readUsage(target:Target):Promise<ReturnType<typeof normalizeUsage>>{
  return new Promise((resolve,reject)=>{
    const child=spawn(target.binary,['app-server'],{env:providerEnvironment(target),stdio:['pipe','pipe','pipe']});
    const lines=createInterface({input:child.stdout});let settled=false;
    const finish=(error?:Error,result?:ReturnType<typeof normalizeUsage>)=>{
      if(settled)return;settled=true;clearTimeout(timer);lines.close();child.kill('SIGTERM');error?reject(error):resolve(result!);
    };
    const timer=setTimeout(()=>finish(new Error('usage_timeout')),20_000);
    child.on('error',()=>finish(new Error('usage_unavailable')));
    child.on('close',()=>{if(!settled)finish(new Error('usage_unavailable'));});
    child.stderr.resume();child.stdin.on('error',()=>{});
    const send=(payload:unknown)=>child.stdin.write(JSON.stringify(payload)+'\n');
    lines.on('line',line=>{
      if(line.length>1_000_000){finish(new Error('usage_response_too_large'));return;}
      try{
        const message=JSON.parse(line);
        if(message.error){finish(new Error('usage_unavailable'));return;}
        if(message.id===1){send({method:'initialized',params:{}});send({id:2,method:'account/rateLimits/read',params:{}});}
        if(message.id===2)finish(undefined,normalizeUsage(message.result,target.account_id));
      }catch{finish(new Error('usage_protocol_error'));}
    });
    send({id:1,method:'initialize',params:{clientInfo:{name:'subscription_workers',version:'0.1.0'},capabilities:{experimentalApi:false}}});
  });
}
