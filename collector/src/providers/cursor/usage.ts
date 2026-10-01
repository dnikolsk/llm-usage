import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {ingestSnapshot} from '@llm-usage/core';
import type {Target} from '../types';
import {usageJson} from '../usage-http';
const number=z.number().finite().nonnegative();
const millis=z.union([z.string().regex(/^\d+$/),number]).transform(Number).refine(n=>Number.isSafeInteger(n)&&n>0&&n<8640000000000000);
const plan=z.object({limit:number.optional(),includedSpend:number.optional(),remaining:number.optional(),totalPercentUsed:number.optional(),
  autoPercentUsed:number.optional(),apiPercentUsed:number.optional(),autoLimit:number.optional(),apiLimit:number.optional(),autoSpend:number.optional(),apiSpend:number.optional()});
export function normalizeUsage(raw:unknown,accountId:string,now=new Date(),planInfoRaw?:unknown){
  const data=z.object({billingCycleStart:millis.optional(),billingCycleEnd:millis,planUsage:plan}).parse(raw);
  const info=planInfoRaw===undefined?undefined:z.object({planInfo:z.object({includedUsageResetsAt:millis.optional(),includedUsagePeriod:z.union([z.string(),z.number()]).optional()}).optional()}).parse(planInfoRaw).planInfo;
  const reset=info?.includedUsageResetsAt??data.billingCycleEnd;
  const kind=info?.includedUsagePeriod==='WEEKLY'||info?.includedUsagePeriod===2?'weekly':'subscription';
  const b=data.planUsage;let percent=b.totalPercentUsed;
  if(percent===undefined&&b.limit!==undefined&&b.limit>0){
    if(b.includedSpend!==undefined)percent=b.includedSpend/b.limit*100;
    else if(b.remaining!==undefined)percent=(1-Math.min(b.remaining,b.limit)/b.limit)*100;
  }
  if(percent===undefined)throw new Error('usage_schema_unrecognized');
  const observed=now.toISOString();
  const definitions=[['included','all_models',percent],['auto','cursor_auto',b.autoPercentUsed],['api','cursor_api',b.apiPercentUsed]] as const;
  const limits=definitions.flatMap(([id,scope,value])=>value===undefined?[]:[{id,account_id:accountId,kind,scope,unit:'fraction',
    ...(id==='included'&&b.limit!==undefined&&b.limit>0&&b.includedSpend!==undefined&&b.includedSpend<=b.limit?{unit:'usd_cents',limit:b.limit,used:b.includedSpend,remaining:Math.max(0,b.limit-b.includedSpend)}:{}),
    used_fraction:Math.min(1,value/100),remaining_fraction:Math.max(0,1-value/100),observed_at:observed,
    window_started_at:data.billingCycleStart===undefined||info?.includedUsageResetsAt!==undefined?null:new Date(data.billingCycleStart).toISOString(),
    reset_at:new Date(reset).toISOString(),source:'local_collector',confidence:'provider_reported'}]);
  // spendLimitUsage is overage, not subscription capacity. No inferred calendar reset.
  return{allowed:null,snapshot:ingestSnapshot.parse({account_id:accountId,provider:'cursor',observed_at:observed,status:'ok',limits,
    metadata:{adapter_version:'cursor-dashboard-v1'}})};
}
export async function readUsage(target:Target){
  if(process.platform!=='linux')throw new Error('usage_credential_store_unsupported');
  // The Linux CLI credential store uses XDG_CONFIG_HOME/cursor/auth.json,
  // independently of CURSOR_CONFIG_DIR. Read only; token refresh remains CLI-owned.
  const credentials=z.object({accessToken:z.string().min(1),apiKey:z.string().nullish()})
    .parse(JSON.parse(await readFile(join(target.auth_dir,'config','cursor','auth.json'),'utf8')));
  if(credentials.apiKey)throw new Error('usage_subscription_login_required');
  const request=(method:string)=>usageJson(`https://api2.cursor.sh/aiserver.v1.DashboardService/${method}`,{
    method:'POST',headers:{Authorization:`Bearer ${credentials.accessToken}`,'Content-Type':'application/json','Connect-Protocol-Version':'1','x-cursor-client-type':'cli'},body:'{}'});
  const [raw,info]=await Promise.all([request('GetCurrentPeriodUsage'),request('GetPlanInfo')]);
  return normalizeUsage(raw,target.account_id,new Date(),info);
}
