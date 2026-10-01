import { readFile, mkdir, writeFile, realpath, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { workerConfig, command, type Target } from './providers/types';
import * as codex from './providers/codex/index';
import {collectUsage} from './usage';
import {executionModel} from './execution-model';
import * as claude from './providers/claude/index';
import * as cursor from './providers/cursor/index';
const config=workerConfig.parse(JSON.parse(await readFile(process.argv[2]??'', 'utf8')));
const token=process.env[config.token_env];
if(!token||token.length<32)throw new Error('worker_token_required');
const service=new URL(config.service_url);
if(service.protocol!=='https:' && !(service.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(service.hostname)))throw new Error('https_required');
async function api(path:string,body:unknown):Promise<any>{
  const response=await fetch(new URL('/v1/execution/worker/'+path,service),{method:'POST',headers:{Authorization:`Bearer ${token}`,'X-Worker-Id':config.worker_id,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15_000)});
  if(!response.ok)throw new Error(`service_${response.status}`);return response.json();
}
const adapter=(target:Target)=>target.provider==='openai'?codex:target.provider==='anthropic'?claude:cursor;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const usageChecked=new Map<string,number>();
// Included-usage permission is separate from percentages. Never assume it after a restart.
const usageDenied=new Set<string>(config.targets.filter(t=>t.provider==='openai').map(t=>t.account_id));
let stopping=false;
let activeAbort:AbortController|undefined;
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{stopping=true;activeAbort?.abort();});
async function health(target:Target){
  const supported=target.mode==='local'||target.provider==='openai';
  let ready=false;
  try{ready=supported&&await adapter(target).authenticated(command(target));}catch{}
  if(ready&&Date.now()-(usageChecked.get(target.account_id)??0)>60_000){
    const usage=await collectUsage(target);
    await api('usage',usage.snapshot);
    usageChecked.set(target.account_id,Date.now()+(usage.snapshot.metadata.diagnostic_code==='usage_rate_limited'?240_000:0));
    if(usage.allowed===false)usageDenied.add(target.account_id);else if(usage.allowed===true)usageDenied.delete(target.account_id);
  }
  await api('health',{target_id:target.id,health:!ready?(supported?'needs_login':'unavailable'):usageDenied.has(target.account_id)?'unavailable':'ready'});
  return ready;
}
async function git(args:string[],cwd?:string):Promise<string>{
  return new Promise((resolve,reject)=>{
    const child=spawn('git',args,{cwd,stdio:['ignore','pipe','pipe']});let out='';
    const timer=setTimeout(()=>child.kill('SIGTERM'),30_000);
    child.stdout.on('data',b=>{out+=b.toString();if(out.length>2_000_000)child.kill('SIGTERM');});
    child.stderr.resume();child.on('error',()=>{clearTimeout(timer);reject(new Error('git_failed'));});
    child.on('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(new Error('git_failed'));});
  });
}
async function execute(job:any,target:Target){
  const controller=new AbortController();let leaseLost=false;let beating=false;
  activeAbort=controller;
  const lease={job_id:job.id,lease_token:job.lease_token};
  const beat=setInterval(async()=>{
    if(beating)return;beating=true;
    try{const state=await api('heartbeat',lease);if(state.cancel_requested)controller.abort();
      await api('health',{target_id:target.id,health:'ready'});
    }catch{leaseLost=true;controller.abort();}finally{beating=false;}
  },20_000);
  const run=command(target);
  const dir=join(config.artifact_dir,job.id);
  let remoteUrl:string|undefined;
  let result:{state:string;summary:string;session_id?:string;artifact_path?:string;remote_url?:string;patch?:string;base_revision?:string};
  try{
    await mkdir(dir,{recursive:true,mode:0o700});
    if(job.account_id!==target.account_id)throw new Error('account_configuration_mismatch');
    const repo=target.repositories[job.request.repository];if(!repo)throw new Error('repository_unavailable');
    let workspace=join(dir,'workspace');
    if(job.continuation_session){
      const previous=await realpath(join(config.artifact_dir,job.request.continue_job_id,'workspace'));
      await symlink(previous,workspace);
    } else if(target.mode==='local'){
      await git(['clone','--local','--no-hardlinks',repo.path,workspace]);
    }
    if(target.mode==='cloud'){
      if(target.provider!=='openai'||!repo.cloud_environment)throw new Error('cloud_not_configured');
      // CLI submission is never retried: the provider may have accepted it before a connection loss.
      const launched=await run(['cloud','exec','--env',repo.cloud_environment,...(repo.branch?['--branch',repo.branch]:[])],
        {cwd:repo.path,input:job.request.prompt,timeout:120_000,signal:controller.signal});
      remoteUrl=codex.cloudTaskUrl(launched.stdout);
      if(launched.code!==0||!remoteUrl)throw new Error('cloud_submission_uncertain');
      await writeFile(join(dir,'remote.json'),JSON.stringify({remote_url:remoteUrl}),{mode:0o600});
      const id=remoteUrl.split('/').at(-1)!;
      const deadline=Date.now()+3_600_000;let complete=false;
      while(Date.now()<deadline){
        if(controller.signal.aborted)throw new Error('remote_task_requires_review');
        const status=await run(['cloud','status',id],{signal:controller.signal});
        const state=codex.cloudState(status.stdout);
        if(status.code!==0||state==='unknown')throw new Error('remote_status_unknown');
        if(state==='failed')throw new Error('remote_task_failed');
        if(state==='ready'){complete=true;break;}
        await sleep(10_000);
      }
      if(!complete)throw new Error('remote_task_timeout');
      const diff=await run(['cloud','diff',id],{signal:controller.signal});
      if(diff.code!==0)throw new Error('remote_diff_unavailable');
      await writeFile(join(dir,'changes.patch'),diff.stdout,{mode:0o600});
      result={state:'succeeded',summary:'Provider cloud task completed; review changes.patch.',remote_url:remoteUrl,artifact_path:dir,...(diff.stdout.length<=48_000?{patch:diff.stdout}:{})};
    }else{
      const provider=adapter(target);
      const baseRevision=(await git(['rev-parse','HEAD'],workspace)).trim();
      const args=provider.localArgs(job.continuation_session??undefined);
      const model=executionModel(target,job);
      if(model)args.splice(target.provider==='openai'?1:0,0,'--model',model);
      const response=await run(args,{input:job.request.prompt,cwd:workspace,timeout:3_600_000,signal:controller.signal});
      const parsed=provider.localResult(response.stdout);
      await git(['add','-N','.'],workspace);
      const diff=await git(['diff','--binary',baseRevision,'--'],workspace);
      await writeFile(join(dir,'changes.patch'),diff,{mode:0o600});
      result={state:response.code===0&&parsed.complete?'succeeded':'needs_review',summary:parsed.summary||'CLI did not report successful completion; review workspace before retrying.',
        ...(parsed.session?{session_id:parsed.session}:{}),artifact_path:dir,base_revision:baseRevision,...(diff.length<=48_000?{patch:diff}:{})};
    }
  }catch(error){
    result={state:'needs_review',summary:error instanceof Error?error.message:'execution_uncertain',artifact_path:dir,...(remoteUrl?{remote_url:remoteUrl}:{})};
  }finally{clearInterval(beat);activeAbort=undefined;}
  // If the lease was lost, do not overwrite the server's uncertain state.
  if(!leaseLost)await api('finish',{...lease,result});
}
await mkdir(config.artifact_dir,{recursive:true,mode:0o700});
for(const target of config.targets)await mkdir(target.auth_dir,{recursive:true,mode:0o700});
console.log(`Worker ${config.worker_id} started; provider credentials stay on this machine.`);
while(!stopping){
  try{
    for(const target of config.targets)await health(target);
    const job=await api('claim',{});
    if(job){const target=config.targets.find(t=>t.id===job.target_id);if(!target)throw new Error('target_not_configured');await execute(job,target);}
    else await sleep(5_000);
  }catch{console.error('Worker operation failed; retrying control connection without replaying a task.');await sleep(10_000);}
}
