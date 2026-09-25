import { randomUUID } from 'node:crypto';
import { ingestSnapshot, type IngestSnapshot } from '@llm-usage/core';
const base=process.env.LLM_USAGE_URL ?? 'http://localhost:3000';
const token=process.env.LLM_USAGE_WRITE_TOKEN;
if (!token) throw new Error('LLM_USAGE_WRITE_TOKEN is required');
const now=new Date();
const iso=(ms:number)=>new Date(ms).toISOString();
function sample(accountId:string,sessionRemaining:number,weeklyRemaining:number):IngestSnapshot {
  const observed=now.toISOString();
  return ingestSnapshot.parse({account_id:accountId,provider:'anthropic',observed_at:observed,status:'ok',metadata:{demo:true},limits:[
    {id:'session-all',account_id:accountId,kind:'session',scope:'all_models',unit:'fraction',used_fraction:1-sessionRemaining,
      remaining_fraction:sessionRemaining,observed_at:observed,reset_at:iso(now.getTime()+72*60_000),source:'estimated',confidence:'estimated'},
    {id:'weekly-all',account_id:accountId,kind:'weekly',scope:'all_models',unit:'fraction',used_fraction:1-weeklyRemaining,
      remaining_fraction:weeklyRemaining,observed_at:observed,reset_at:iso(now.getTime()+3*86_400_000),source:'estimated',confidence:'estimated'}]});
}
for (const s of [sample('claude-personal',0.68,0.47),sample('claude-work',0.81,0.66)]) {
  try {
    const response=await fetch(new URL('/v1/ingest',base),{method:'POST',headers:{Authorization:`Bearer ${token}`,'Idempotency-Key':randomUUID(),'Content-Type':'application/json'},body:JSON.stringify(s)});
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    console.log(`${s.account_id}: ${response.status}`);
  } catch (error) { console.error(`${s.account_id}:`,error); process.exitCode=1; }
}
