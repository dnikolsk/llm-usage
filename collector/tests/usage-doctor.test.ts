import {describe,it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,stat,symlink,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {workerConfig} from '../src/providers/types';
import {normalizeUsage as claude} from '../src/providers/claude/usage';
import {diagnoseUsage,publisherCandidates} from '../src/usage-doctor';

const now=new Date('2026-10-03T12:00:00Z');
const snapshot=claude({five_hour:{utilization:0,resets_at:null},seven_day:{utilization:37,resets_at:'2026-10-04T01:00:00-04:00'},
 extra_usage:{is_enabled:true,monthly_limit:10000,used_credits:2500}},'claude-personal',now).snapshot;
const usage={id:snapshot.account_id,provider:snapshot.provider,status:'available',observed_at:snapshot.observed_at,limits:snapshot.limits,paid_usage:snapshot.metadata.paid_usage,
 label:'DO_NOT_PRINT_LABEL',raw_metadata:{accessToken:'DO_NOT_PRINT_METADATA'}};
const config=workerConfig.parse({service_url:'https://control.example',worker_id:'worker-1',token_env:'WORKER_TOKEN',artifact_dir:'/jobs',
 targets:[{id:'claude-local',account_id:'claude-personal',provider:'anthropic',mode:'local',binary:'/bin/claude',auth_dir:'/auth/claude',repositories:{}}],
 usage_mirror:{service_url:'https://dashboard.example',token_env:'DASHBOARD_WRITE_TOKEN'}});
const env={JOB_TOKEN:'j'.repeat(32),LLM_USAGE_DASHBOARD_READ_TOKEN:'r'.repeat(32),WORKER_TOKEN:'w'.repeat(32),DASHBOARD_WRITE_TOKEN:'d'.repeat(32)};
const options={dashboard:'https://dashboard.example',collect:true};
function fetcher(dashboard:unknown=usage){return vi.fn(async(url:URL|RequestInfo,init?:RequestInit)=>{
 expect(init?.method).toBe('GET');expect(init?.redirect).toBe('error');
 if(String(url).startsWith('https://control.example/')){
  expect(init?.headers).toEqual({Authorization:`Bearer ${env.JOB_TOKEN}`});
  return Response.json({accounts:[{id:usage.id,usage}],targets:[{raw:'DO_NOT_PRINT_TARGET'}]});
 }
 expect(init?.headers).toEqual({Authorization:`Bearer ${env.LLM_USAGE_DASHBOARD_READ_TOKEN}`});
 return Response.json({accounts:[dashboard]});
});}
const collect=vi.fn(async()=>({snapshot}));

describe('live usage diagnostics',()=>{
 it('compares all three sources using GET only and emits normalized data without secrets',async()=>{
  const send=fetcher();
  const report=await diagnoseUsage(config,options,{env,now,fetch:send,collect});
  expect(report.result).toBe('pass');expect(send).toHaveBeenCalledTimes(2);
  expect(report.checks).toContainEqual({account:usage.id,status:'pass',code:'paid_usage_matches'});
  expect(report.providers[0].limits[0].reset_at).toBeNull();
  expect(report.providers[0].limits[1].reset_at).toBe('2026-10-04T05:00:00.000Z');
  expect(report.providers[0].paid_usage[0].remaining).toBe(7500);
  const json=JSON.stringify(report);expect(json).not.toContain('DO_NOT_PRINT');
  for(const secret of Object.values(env))expect(json).not.toContain(secret);
 });
 it('reproduces the legacy dashboard failure: missing Claude dates and paid balances',async()=>{
  const legacy={...usage,limits:usage.limits.map(bucket=>({...bucket,id:bucket.kind+'-all',reset_at:null})),paid_usage:[]};
  const report=await diagnoseUsage({...config,usage_mirror:undefined},options,{env,now,fetch:fetcher(legacy),collect});
  expect(report.result).toBe('fail');
  expect(report.checks).toEqual(expect.arrayContaining([
   {status:'fail',code:'dashboard_mirror_missing_or_different'},
   {account:usage.id,status:'fail',code:'reset_mismatch'},
   {account:usage.id,status:'fail',code:'paid_usage_missing'},
  ]));
 });
 it('detects wrong paid amounts and stale observations without calling them current',async()=>{
  const dashboard={...usage,observed_at:'2026-10-02T12:00:00Z',paid_usage:usage.paid_usage?.map(paid=>({...paid,remaining:1}))};
  const report=await diagnoseUsage(config,options,{env,now,fetch:fetcher(dashboard),collect});
  expect(report.checks).toContainEqual({account:usage.id,status:'fail',code:'paid_usage_mismatch'});
  expect(report.checks).toContainEqual({account:usage.id,status:'fail',code:'dashboard_freshness'});
 });
 it('uses explicit destination account mappings and rejects provider mismatches',async()=>{
  const mapped={...config,usage_mirror:{...config.usage_mirror!,account_ids:{[usage.id]:'claude-dashboard'}}};
  expect((await diagnoseUsage(mapped,options,{env,now,fetch:fetcher({...usage,id:'claude-dashboard'}),collect})).result).toBe('pass');
  const bad=await diagnoseUsage(mapped,options,{env,now,fetch:fetcher({...usage,id:'claude-dashboard',provider:'openai'}),collect});
  expect(bad.checks).toContainEqual({account:usage.id,status:'fail',code:'dashboard_provider_mismatch'});
 });
 it('does not collect providers unless explicitly requested',async()=>{
  const noCollect=vi.fn();
  const report=await diagnoseUsage(config,{dashboard:options.dashboard},{env,now,fetch:fetcher(),collect:noCollect});
  expect(report.result).toBe('pass');expect(noCollect).not.toHaveBeenCalled();
 });
 it('reports missing read credentials without requiring worker or write credentials',async()=>{
  const send=vi.fn();
  const report=await diagnoseUsage(config,options,{env:{},now,fetch:send,collect});
  expect(report.result).toBe('blocked');expect(send).not.toHaveBeenCalled();
  expect(report.providers).toHaveLength(1);
  expect(report.control.status).toBe('token_missing');expect(report.dashboard.status).toBe('token_missing');
  expect((await diagnoseUsage(config,options,{env:{JOB_TOKEN:env.JOB_TOKEN,LLM_USAGE_DASHBOARD_READ_TOKEN:env.LLM_USAGE_DASHBOARD_READ_TOKEN},now,fetch:fetcher(),collect})).result).toBe('pass');
 });
 it.each([401,403,503])('reports HTTP %s without echoing server responses',async status=>{
  const report=await diagnoseUsage(config,options,{env,now,fetch:async()=>new Response('DO_NOT_PRINT_BODY',{status}),collect});
  expect(report.result).toBe('blocked');expect(report.dashboard.status).toBe(`http_${status}`);
  expect(JSON.stringify(report)).not.toContain('DO_NOT_PRINT_BODY');
 });
 it('redacts network exceptions and rejects oversized or unexpected response bodies',async()=>{
  for(const send of [async()=>{throw new Error(env.JOB_TOKEN);},async()=>new Response('<html>DO_NOT_PRINT</html>'),async()=>new Response('x'.repeat(2_000_001))]){
   const report=await diagnoseUsage(config,options,{env,now,fetch:send,collect});
   expect(report.result).toBe('blocked');expect(report.dashboard.status).toBe('connection_or_schema_error');
   expect(JSON.stringify(report)).not.toContain(env.JOB_TOKEN);
  }
 });
 it('does not certify a missing paid observation as zero or a failed collection as healthy',async()=>{
  const absent={...snapshot,metadata:{}};
  const report=await diagnoseUsage(config,options,{env,now,fetch:fetcher({...usage,paid_usage:[]}),collect:async()=>({snapshot:absent})});
  expect(report.result).toBe('unknown');
  expect(report.checks).toContainEqual({account:usage.id,status:'unknown',code:'source_paid_usage_not_reported'});
  const failed=await diagnoseUsage(config,options,{env,now,fetch:fetcher(),collect:async()=>({snapshot:{...absent,status:'error',limits:[],metadata:{diagnostic_code:'usage_auth_required'}}})});
  expect(failed.result).toBe('blocked');expect(failed.providers[0].usage_diagnostic).toBe('usage_auth_required');
 });
 it('refuses cleartext, embedded credentials and forwarding a control token to another service',async()=>{
  const send=vi.fn();
  for(const dashboard of ['http://dashboard.example','https://user:secret@dashboard.example','https://dashboard.example?token=secret']){
   await expect(diagnoseUsage(config,{dashboard},{env,fetch:send})).rejects.toThrow('https_required');
  }
  await expect(diagnoseUsage(config,options,{env:{...env,LLM_USAGE_DASHBOARD_READ_TOKEN:env.JOB_TOKEN},fetch:send})).rejects.toThrow('separate_service_tokens_required');
  expect(send).not.toHaveBeenCalled();
 });
 it('lists process candidates without command arguments or process environment contents',async()=>{
  const root=await mkdtemp(join(tmpdir(),'usage-process-test-'));const dir=join(root,'999999');
  try{
   await mkdir(dir);await writeFile(join(dir,'cmdline'),'/usr/bin/node\0/opt/llm-usage/worker.ts\0config/worker.json\0--token\0DO_NOT_PRINT_TOKEN\0');
   await writeFile(join(dir,'environ'),'PASSWORD=DO_NOT_PRINT_PASSWORD');
   await writeFile(join(dir,'cgroup'),'0::/system.slice/llm-worker.service\n');
   await symlink('/opt/llm-usage',join(dir,'cwd'));
   const report=await publisherCandidates(root);
   expect(report.candidates).toEqual([{pid:999999,executable:'node',directory:'/opt/llm-usage',scripts:['worker.ts'],services:['llm-worker.service'],worker_config:'/opt/llm-usage/config/worker.json'}]);
   expect(JSON.stringify(report)).not.toContain('DO_NOT_PRINT');
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('writes a private CLI report and returns exit 2 for blocked checks instead of claiming success',async()=>{
  const root=await mkdtemp(join(tmpdir(),'usage-doctor-cli-'));
  try{
   const path=join(root,'worker.json'),output=join(root,'report.json');
   await writeFile(path,JSON.stringify(config));
   const result=await new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs',import.meta.url)),'src/usage-doctor-cli.ts',path,'--dashboard',options.dashboard,'--output',output],{
      cwd:fileURLToPath(new URL('..',import.meta.url)),env:{PATH:process.env.PATH,UNRELATED_SECRET:'DO_NOT_PRINT_ENV'},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
    child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
   });
   expect(result.code).toBe(2);expect(JSON.parse(result.stdout).result).toBe('blocked');
   expect(await readFile(output,'utf8')).toBe(result.stdout);
   expect((await stat(output)).mode&0o777).toBe(0o600);
   expect(result.stdout+result.stderr).not.toContain('DO_NOT_PRINT_ENV');
  }finally{await rm(root,{recursive:true,force:true});}
 });
});
