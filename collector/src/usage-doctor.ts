import {readFile,readdir,readlink,stat} from 'node:fs/promises';
import {basename,resolve} from 'node:path';
import {z} from 'zod';
import {accountId,paidUsage,utcTimestamp,type IngestSnapshot} from '@llm-usage/core';
import {collectUsage} from './usage';
import type {Target,WorkerConfig} from './providers/types';

const name=z.string().regex(/^[a-zA-Z0-9._/-]{1,120}$/);
const diagnostic=z.enum(['usage_auth_required','usage_rate_limited','usage_http_error','usage_empty_response','usage_response_too_large',
  'usage_credentials_missing','usage_invalid_json','usage_schema_unrecognized','usage_credential_store_unsupported','usage_subscription_login_required','usage_unavailable']);
const reading=z.object({
  id:accountId,provider:name,observed_at:utcTimestamp.nullable(),
  status:z.enum(['ok','available','partial','error','unknown']),
  limits:z.array(z.object({id:name,kind:name,scope:name,reset_at:utcTimestamp.nullable(),remaining_fraction:z.number().min(0).max(1).nullable()})).max(40),
  paid_usage:z.array(paidUsage.omit({label:true}).strip()).max(8).default([]),
  usage_diagnostic:diagnostic.nullable().default(null),
  paid_usage_diagnostic:z.literal('paid_usage_schema_unrecognized').nullable().default(null),
});
type Reading=z.infer<typeof reading>;
type Check={account?:string;status:'pass'|'fail'|'blocked'|'unknown';code:string};
type ServiceRead={status:string;accounts:Reading[]};
type Options={dashboard:string;controlTokenEnv?:string;dashboardTokenEnv?:string;collect?:boolean};
type Dependencies={env?:NodeJS.ProcessEnv;fetch?:typeof fetch;collect?:(target:Target)=>Promise<{snapshot:IngestSnapshot}>;now?:Date};

export function serviceOrigin(value:string){
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash||
    (url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new Error('https_required');
  return url.origin;
}

async function limitedJson(response:Response){
  const reader=response.body?.getReader();if(!reader)throw new Error('empty_response');
  const chunks:Uint8Array[]=[];let size=0;
  try{
    while(true){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>2_000_000)throw new Error('response_too_large');chunks.push(value);}
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  }finally{await reader.cancel().catch(()=>{});}
}

async function get(origin:string,path:string,tokenName:string,execution:boolean,env:NodeJS.ProcessEnv,send:typeof fetch):Promise<ServiceRead>{
    if(!/^[A-Z][A-Z0-9_]+$/.test(tokenName))throw new Error('invalid_token_variable');
    const token=env[tokenName];if(!token||token.length<32)return{status:'token_missing',accounts:[]};
    try{
      const response=await send(new URL(path,origin),{method:'GET',redirect:'error',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
      if(!response.ok)return{status:`http_${response.status}`,accounts:[]};
      const raw=z.object({accounts:z.array(z.unknown()).max(1000)}).parse(await limitedJson(response));
      const accounts=raw.accounts.flatMap(item=>{
        if(!execution)return[reading.parse(item)];
        const wrapper=z.object({id:accountId,usage:z.unknown().nullable()}).parse(item);
        return wrapper.usage==null?[]:[reading.parse(wrapper.usage)];
      });
      return{status:'ok',accounts};
    }catch{return{status:'connection_or_schema_error',accounts:[]};}
}

export async function inspectDashboard(url:string,tokenName='LLM_USAGE_DASHBOARD_READ_TOKEN',deps:Pick<Dependencies,'env'|'fetch'>={}){
  const origin=serviceOrigin(url);
  return{origin,...await get(origin,'/v1/status',tokenName,false,deps.env??process.env,deps.fetch??fetch)};
}

/** Only normalized quota fields leave this function; never return bodies, labels or errors. */
export async function diagnoseUsage(config:WorkerConfig,options:Options,deps:Dependencies={}){
  const env=deps.env??process.env,send=deps.fetch??fetch,collect=deps.collect??collectUsage,now=deps.now??new Date();
  const control=serviceOrigin(config.service_url),dashboard=serviceOrigin(options.dashboard);
  const controlTokenEnv=options.controlTokenEnv??'JOB_TOKEN',dashboardTokenEnv=options.dashboardTokenEnv??'LLM_USAGE_DASHBOARD_READ_TOKEN';
  if(!/^[A-Z][A-Z0-9_]+$/.test(controlTokenEnv)||!/^[A-Z][A-Z0-9_]+$/.test(dashboardTokenEnv))throw new Error('invalid_token_variable');
  if(control!==dashboard&&env[controlTokenEnv]&&env[controlTokenEnv]===env[dashboardTokenEnv])throw new Error('separate_service_tokens_required');
  const controlRead=await get(control,'/v1/execution/accounts',controlTokenEnv,true,env,send);
  const dashboardRead=await get(dashboard,'/v1/status',dashboardTokenEnv,false,env,send);
  const checks:Check[]=[];
  const add=(status:Check['status'],code:string,account?:string)=>checks.push({status,code,...(account?{account}:{})});
  for(const [service,result] of [['control',controlRead],['dashboard',dashboardRead]] as const)add(result.status==='ok'?'pass':'blocked',`${service}_${result.status}`);
  const mirror=config.usage_mirror;
  const mirrorOrigin=mirror?serviceOrigin(mirror.service_url):null;
  add(control===dashboard||mirrorOrigin===dashboard?'pass':'fail',control===dashboard?'same_service':mirrorOrigin===dashboard?'mirror_destination_matches':'dashboard_mirror_missing_or_different');
  const targets=[...new Map(config.targets.map(target=>[target.account_id,target])).values()];
  const local:Reading[]=[];
  for(const target of targets){
    if(options.collect){
      try{
        const {snapshot}=await collect(target);
        local.push(reading.parse({...snapshot,id:snapshot.account_id,paid_usage:snapshot.metadata.paid_usage??[],usage_diagnostic:snapshot.metadata.diagnostic_code??null,paid_usage_diagnostic:snapshot.metadata.paid_usage_diagnostic??null}));
        add(snapshot.status==='error'?'blocked':'pass',snapshot.status==='error'?'provider_collection_failed':'provider_collection_ok',target.account_id);
      }catch{add('blocked','provider_collection_failed',target.account_id);}
    }
    const source=(options.collect?local:controlRead.accounts).find(account=>account.id===target.account_id);
    const destinationId=mirror?.account_ids[target.account_id]??target.account_id;
    const destination=dashboardRead.accounts.find(account=>account.id===destinationId);
    if(!destination){add(dashboardRead.status==='ok'?'fail':'blocked','dashboard_account_unavailable',target.account_id);continue;}
    if(destination.provider!==target.provider){add('fail','dashboard_provider_mismatch',target.account_id);continue;}
    const age=destination.observed_at?now.getTime()-Date.parse(destination.observed_at):Infinity;
    add(age>=-60_000&&age<=600_000&&destination.status!=='error'?'pass':'fail','dashboard_freshness',target.account_id);
    if(!source||source.status==='error'){add('blocked','comparison_source_unavailable',target.account_id);continue;}
    const sourceAge=source.observed_at?now.getTime()-Date.parse(source.observed_at):Infinity;
    if(sourceAge< -60_000||sourceAge>600_000){add('blocked','comparison_source_stale',target.account_id);continue;}
    if(!source.limits.length)add('unknown','source_quota_not_reported',target.account_id);
    for(const bucket of source.limits){
      const matching=destination.limits.find(value=>value.kind===bucket.kind&&value.scope===bucket.scope);
      add(!matching?'fail':matching.reset_at===bucket.reset_at?'pass':'fail',!matching?'quota_bucket_missing':matching.reset_at===bucket.reset_at?'reset_matches':'reset_mismatch',target.account_id);
    }
    if(!source.paid_usage.length){add('unknown','source_paid_usage_not_reported',target.account_id);continue;}
    if(source.paid_usage.every(paid=>paid.remaining===null&&paid.used===null&&paid.limit===null&&!paid.unlimited&&paid.enabled!==false))add('unknown','source_paid_amounts_not_reported',target.account_id);
    const paidFields=(paid:Reading['paid_usage'][number])=>({id:paid.id,kind:paid.kind,unit:paid.unit,remaining:paid.remaining,used:paid.used,limit:paid.limit,enabled:paid.enabled,unlimited:paid.unlimited,reset_at:paid.reset_at});
    const expected=source.paid_usage.map(paidFields).sort((a,b)=>a.id.localeCompare(b.id));
    const actual=destination.paid_usage.map(paidFields).sort((a,b)=>a.id.localeCompare(b.id));
    add(JSON.stringify(expected)===JSON.stringify(actual)?'pass':'fail',!actual.length?'paid_usage_missing':JSON.stringify(expected)===JSON.stringify(actual)?'paid_usage_matches':'paid_usage_mismatch',target.account_id);
  }
  return{version:1,observed_at:now.toISOString(),mode:'read_only',result:checks.some(c=>c.status==='fail')?'fail':checks.some(c=>c.status==='blocked')?'blocked':checks.some(c=>c.status==='unknown')?'unknown':'pass',
    configuration:{worker_id:config.worker_id,control,dashboard,mirror:mirrorOrigin,account_ids:mirror?.account_ids??{},
      credential_presence:{control_token:!!env[controlTokenEnv],dashboard_read_token:!!env[dashboardTokenEnv],mirror_write_token:mirror?!!env[mirror.token_env]:false}},
    checks,providers:local,control:controlRead,dashboard:dashboardRead};
}

/** Best-effort discovery of same-user processes, never printing command lines or environments. */
export async function publisherCandidates(proc='/proc'){
  const candidates:{pid:number;executable:string;directory:string|null;scripts:string[];services:string[];worker_config:string|null}[]=[];
  let otherUsers=0,unreadable=0,visible=0;
  let entries:string[];try{entries=await readdir(proc);}catch{return{status:'unavailable',candidates};}
  for(const entry of entries.filter(value=>/^\d+$/.test(value))){
    const pid=Number(entry);if(pid===process.pid||pid===process.ppid)continue;
    try{
      if((await stat(`${proc}/${entry}`)).uid!==process.getuid?.()){otherUsers++;continue;}
      visible++;
      const args=(await readFile(`${proc}/${entry}/cmdline`,'utf8')).split('\0');
      const scripts=args.filter(arg=>/^[a-zA-Z0-9_./-]+\.(?:mjs|cjs|js|ts|py|sh)$/.test(arg)).map(arg=>basename(arg));
      const directory=await readlink(`${proc}/${entry}/cwd`).catch(()=>null);
      if(directory?.split('/').some(part=>part.startsWith('llm-usage-diagnostic.')))continue;
      if(!scripts.some(script=>/usage|collector|worker/i.test(script))&&!directory?.includes('llm-usage'))continue;
      const cgroup=await readFile(`${proc}/${entry}/cgroup`,'utf8').catch(()=>'');
      const services=[...cgroup.matchAll(/(?:^|\/)([a-zA-Z0-9_.@-]+\.service)(?:\/|$)/gm)].map(match=>match[1]);
      const workerIndex=args.findIndex(arg=>/^(worker|usage-sync)\.(ts|js)$/.test(basename(arg)));
      const configArgument=workerIndex>=0?args[workerIndex+1]:null;
      const worker_config=directory&&configArgument&&/^[a-zA-Z0-9_./-]+\.json$/.test(configArgument)?resolve(directory,configArgument):null;
      candidates.push({pid,executable:basename(args[0]??''),directory,scripts,services,worker_config});
    }catch{unreadable++;}
  }
  return{status:'candidates_only_not_proof_of_publisher',same_user_processes_visible:visible,other_user_processes_skipped:otherUsers,unreadable_processes:unreadable,candidates};
}
