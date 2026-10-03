import { spawn } from 'node:child_process';
import { z } from 'zod';
const tokenName=z.string().regex(/^[A-Z][A-Z0-9_]+$/);
export const workerConfig = z.object({
  service_url:z.url(), worker_id:z.string().regex(/^[a-z][a-z0-9_-]{1,79}$/),
  token_env:tokenName,
  /** Retired: the service reads usage itself. Accepted and ignored so existing configs keep starting. */
  usage_mirror:z.unknown().optional(),
  artifact_dir:z.string().startsWith('/'),
  targets:z.array(z.object({
    id:z.string(), account_id:z.string(), provider:z.enum(['openai','anthropic','cursor','google']),
    label:z.string().min(1).max(100).optional(), account_type:z.enum(['personal','work']).default('personal'),
    billing:z.enum(['subscription','paid','unknown']).default('unknown'), setup_minutes:z.number().int().min(0).default(0),
    mode:z.enum(['local','cloud']), binary:z.string().startsWith('/'), auth_dir:z.string().startsWith('/'),
    default_model:z.string().min(1).max(160).optional(),
    models:z.record(z.string(),z.string().min(1)).default({}),
    repositories:z.record(z.string(),z.object({path:z.string().startsWith('/'),cloud_environment:z.string().optional(),branch:z.string().optional()})),
  }).strict()).min(1),
}).strict();
export type WorkerConfig=z.infer<typeof workerConfig>;
export type Target=WorkerConfig['targets'][number];
export type CommandResult={code:number;stdout:string;stderr:string};
export type Run=(args:string[],options?:{input?:string;cwd?:string;timeout?:number;signal?:AbortSignal})=>Promise<CommandResult>;
/** Deliberately do not inherit API keys or the bot's own account/session credentials. */
export function providerEnvironment(target:Target):NodeJS.ProcessEnv {
  const env:NodeJS.ProcessEnv={};
  for(const name of ['PATH','LANG','LC_ALL','TMPDIR','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','no_proxy','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE']) {
    if(process.env[name]) env[name]=process.env[name];
  }
  env.NO_COLOR='1';env.NO_OPEN_BROWSER='1';
  env.XDG_CACHE_HOME=target.auth_dir+'/cache';
  env.XDG_CONFIG_HOME=target.auth_dir+'/config';
  if(target.provider==='openai') env.CODEX_HOME=target.auth_dir;
  if(target.provider==='anthropic') env.CLAUDE_CONFIG_DIR=target.auth_dir;
  if(target.provider==='cursor'){env.AGENT_CLI_CREDENTIAL_STORE='file';env.CURSOR_CONFIG_DIR=target.auth_dir;env.CURSOR_AGENT_STORE_DIR=target.auth_dir+'/sessions';}
  // Gemini CLI keeps its store under HOME/.gemini; an account-specific HOME isolates it like the other providers.
  if(target.provider==='google'){env.HOME=target.auth_dir;env.NO_BROWSER='true';}
  return env;
}
export function command(target:Target):Run {
  return (args,options={})=>new Promise((resolve,reject)=>{
    const child=spawn(target.binary,args,{env:providerEnvironment(target),cwd:options.cwd,stdio:['pipe','pipe','pipe'],detached:true});
    let stdout='',stderr='',overflow=false,timedOut=false,aborted=false,killTimer:ReturnType<typeof setTimeout>|undefined;
    const stop=()=>{ try{process.kill(-child.pid!,'SIGTERM');}catch{}; killTimer=setTimeout(()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{}},2000); };
    const abort=()=>{aborted=true;stop();};
    const timer=setTimeout(()=>{timedOut=true;stop();},options.timeout??30_000);
    options.signal?.addEventListener('abort',abort,{once:true});
    if(options.signal?.aborted) abort();
    const read=(chunk:Buffer,isError:boolean)=>{
      if(stdout.length+stderr.length+chunk.length>2_000_000){overflow=true;stop();return;}
      if(isError) stderr+=chunk.toString();else stdout+=chunk.toString();
    };
    child.stdout.on('data',c=>read(c,false));child.stderr.on('data',c=>read(c,true));
    child.stdin.on('error',()=>{});child.stdin.end(options.input??'');
    child.on('error',()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);reject(new Error('cli_start_failed'));});
    child.on('close',code=>{clearTimeout(timer);if(killTimer)clearTimeout(killTimer);options.signal?.removeEventListener('abort',abort);
      if(overflow||timedOut||aborted)reject(new Error(overflow?'output_limit':timedOut?'cli_timeout':'cancelled'));
      else resolve({code:code??1,stdout,stderr});});
  });
}
export function jsonLines(text:string):Record<string,any>[] {
  return text.split('\n').filter(Boolean).flatMap(line=>{try{return[JSON.parse(line)];}catch{return[];}});
}
