#!/usr/bin/env node
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve,join,relative,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const baseNames=/^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LC_[A-Z_]+|TMPDIR|TMP|TEMP|XDG_[A-Z_]+|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|https?_proxy|all_proxy|no_proxy|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|SSH_AUTH_SOCK|PGHOST|PGPORT|PGUSER)$/;
export async function initialize(args,env=process.env){
 const opts={};
 for(let i=0;i<args.length;i+=2){
  const flag=args[i],value=args[i+1];
  if(!['--directory','--worker-id'].includes(flag)||!value||opts[flag])throw new Error('Expected --directory PRIVATE_DIRECTORY [--worker-id ID]');
  opts[flag]=value;
 }
 if(!opts['--directory'])throw new Error('Specify --directory outside the repository for private setup files.');
 const output=resolve(opts['--directory']),rel=relative(repository,output);
 if(rel===''||(!rel.startsWith('../')&&rel!=='..'))throw new Error('Private setup directory must be outside this repository.');
 const worker=opts['--worker-id']??'worker-1';
 if(!/^[a-z][a-z0-9_-]{1,60}$/.test(worker))throw new Error('Invalid worker ID (2–61 lowercase letters, digits, underscores or hyphens).');
 const workerKey=`WORKER_${worker.replaceAll('-','_').toUpperCase()}_TOKEN`;
 const names=['READ_TOKEN','WRITE_TOKEN','JOB_TOKEN','ADMIN_TOKEN','DASHBOARD_PASSWORD',workerKey];
 const secrets={};
 for(const name of names){
  if(env[name]!==undefined&&(env[name].length<32||env[name].startsWith('replace-with-')))throw new Error(`Existing ${name} is invalid; use an independent random value of at least 32 characters.`);
  secrets[name]=env[name]??randomBytes(32).toString('hex');
 }
 if(new Set(Object.values(secrets)).size!==names.length)throw new Error('Existing role secrets must be independent.');
 // Encrypts stored provider logins; web role only. Rotating it makes every connected provider need a new sign-in.
 if(env.LLM_SESSION_KEY!==undefined&&!/^[0-9a-fA-F]{64}$/.test(env.LLM_SESSION_KEY))throw new Error('Existing LLM_SESSION_KEY is invalid; use 64 hex characters.');
 const sessionKey=env.LLM_SESSION_KEY??randomBytes(32).toString('hex');
 const database=env.DATABASE_URL;
 if(database){
  let url;try{url=new URL(database);}catch{throw new Error('DATABASE_URL must be a PostgreSQL connection URI.');}
  if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('DATABASE_URL must be a PostgreSQL connection URI.');
 }
 const roles={
  web:{...secrets,LLM_SESSION_KEY:sessionKey,...(database?{DATABASE_URL:database}:{})},
  worker:{[workerKey]:secrets[workerKey]},
  client:{JOB_TOKEN:secrets.JOB_TOKEN,READ_TOKEN:secrets.READ_TOKEN},
  operator:{ADMIN_TOKEN:secrets.ADMIN_TOKEN,...(database?{DATABASE_URL:database}:{})},
 };
 // Atomic directory creation refuses existing setups, so retry cannot rotate bindings.
 await mkdir(output,{mode:0o700});
 try{
  for(const [role,variables] of Object.entries(roles))await writeFile(join(output,`${role}-secrets.json`),JSON.stringify({role,variables},null,2)+'\n',{flag:'wx',mode:0o600});
  await writeFile(join(output,'setup.json'),JSON.stringify({version:1,worker_id:worker,token_env:workerKey,database_configured:!!database,roles:Object.fromEntries(Object.keys(roles).map(role=>[role,`${role}-secrets.json`])),guide:'docs/deploy-your-own.md'},null,2)+'\n',{flag:'wx',mode:0o600});
 }catch(error){await rm(output,{recursive:true,force:true});throw error;}
 return {directory:output,worker_id:worker,token_env:workerKey,database_configured:!!database};
}
export async function run(args,env=process.env){
 if(args[0]!=='--file'||!args[1]||args[2]!=='--'||!args[3])throw new Error('Expected run --file PRIVATE_ROLE_JSON -- COMMAND [ARGS]');
 const data=JSON.parse(await readFile(resolve(args[1]),'utf8'));
 if(!['web','worker','client','operator'].includes(data.role)||!data.variables||Array.isArray(data.variables)||typeof data.variables!=='object')throw new Error('Invalid role file');
 const allowed={web:/^(DATABASE_URL|LLM_SESSION_KEY|READ_TOKEN|WRITE_TOKEN|JOB_TOKEN|ADMIN_TOKEN|DASHBOARD_PASSWORD|WORKER_[A-Z0-9_]+_TOKEN|MCP_ALLOWED_ORIGINS)$/,worker:/^WORKER_[A-Z0-9_]+_TOKEN$/,client:/^(JOB_TOKEN|READ_TOKEN)$/,operator:/^(ADMIN_TOKEN|DATABASE_URL)$/}[data.role];
 for(const [name,value] of Object.entries(data.variables))if(!allowed.test(name)||typeof value!=='string'||!value)throw new Error('Invalid variable for this role');
 const childEnv={...Object.fromEntries(Object.entries(env).filter(([name])=>baseNames.test(name))),...data.variables};
 return new Promise(resolve=>{
  const child=spawn(args[3],args.slice(4),{env:childEnv,stdio:'inherit',detached:true});
  const signal=s=>{try{process.kill(-child.pid,s);}catch{}};
  const term=()=>signal('SIGTERM'),interrupt=()=>signal('SIGINT');
  process.on('SIGTERM',term);process.on('SIGINT',interrupt);
  const cleanup=()=>{process.off('SIGTERM',term);process.off('SIGINT',interrupt);};
  child.once('error',()=>{cleanup();console.error('Unable to start setup command.');resolve(1);});
  child.once('exit',(code,signal)=>{cleanup();resolve(code??(signal==='SIGINT'?130:143));});
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const [action,...args]=process.argv.slice(2);
  if(action==='init'){
   const result=await initialize(args);console.log(JSON.stringify(result,null,2));
   console.log('Private role files created. No values printed, resources deployed, accounts connected or workers started. Follow docs/deploy-your-own.md.');
  }else if(action==='run')process.exitCode=await run(args);
  else throw new Error('Usage: node scripts/setup.mjs init --directory PRIVATE_DIRECTORY [--worker-id ID] | run --file ROLE_JSON -- COMMAND [ARGS]');
 }catch(error){console.error(error.code==='EEXIST'?'Setup directory exists; preserving credentials.':error.code?'Unable to read or write private setup files.':error instanceof SyntaxError?'Invalid role JSON.':error.message);process.exitCode=1;}
}
