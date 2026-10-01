import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,mkdir,readFile,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {describe,it,expect} from 'vitest';

describe('worker execution boundary',()=>{
 it.each(['openai','cursor'] as const)('runs a %s coding task with the planned model and returns its patch',async provider=>{
  const root=await mkdtemp(join(tmpdir(),'subscription-worker-test-'));const repo=join(root,'repo');await mkdir(repo);
  execFileSync('git',['init','-q',repo]);await writeFile(join(repo,'sample.txt'),'before\n');
  execFileSync('git',['-C',repo,'add','.']);execFileSync('git',['-C',repo,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','fixture']);
  const binary=join(root,'fake-codex');await writeFile(binary,`#!/usr/bin/env node
const fs=require('node:fs');
if(process.argv[2]==='status'){console.log(JSON.stringify({isAuthenticated:true,hasAccessToken:true}));process.exit(0);}
if(process.argv[2]==='models'){console.log('Available models\\nauto');process.exit(0);}
if(process.argv[2]==='login'){console.log('Logged in using ChatGPT');process.exit(0);}
if(process.argv[2]==='app-server'){
 let input='';process.stdin.on('data',c=>{input+=c;let i;while((i=input.indexOf('\\n'))>=0){const m=JSON.parse(input.slice(0,i));input=input.slice(i+1);if(m.id===1)console.log(JSON.stringify({id:1,result:{}}));if(m.id===2)console.log(JSON.stringify({id:2,result:{ordinaryUsageAllowed:true,rateLimits:{primary:null,secondary:null}}}));}});
}else{
 if(${JSON.stringify(provider)}==='cursor'&&(process.argv[2]!=='--model'||process.argv[3]!=='auto'||!process.argv.includes('--trust')||!process.argv.includes('enabled')))process.exit(9);
 process.stdin.resume();process.stdin.on('end',()=>{fs.writeFileSync('sample.txt','after\\n');console.log(JSON.stringify({type:'thread.started',thread_id:'fixture-session'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Changed the fixture file.'}}));console.log(JSON.stringify({type:'turn.completed'}));console.log(JSON.stringify({type:'result',subtype:'success',session_id:'fixture-session',result:'Done'}));});
}
`);await chmod(binary,0o700);
  let claimed=false;let finish:(data:any)=>void=()=>{};
  const completed=new Promise<any>(resolve=>{finish=resolve;});
  const id='11111111-1111-4111-8111-111111111111';
  const server=createServer(async(req,res)=>{
   let body='';for await(const part of req)body+=part.toString();const data=JSON.parse(body||'{}');
   expect(req.headers.authorization).toBe('Bearer '+ 't'.repeat(40));expect(req.headers['x-worker-id']).toBe('fixture-worker');
   let result:unknown={};
   if(req.url?.endsWith('/claim')){result=claimed?null:{id,account_id:'fixture-personal',target_id:'fixture-local',decision:{selected:{model:provider==='cursor'?'auto':null,quota_scope:provider==='cursor'?'cursor_auto':null}},lease_token:'a'.repeat(64),request:{repository:'fixture-repo',prompt:'Change the fixture file.'}};claimed=true;}
   if(req.url?.endsWith('/finish'))finish(data.result);
   if(req.url?.endsWith('/heartbeat'))result={cancel_requested:false};
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const port=(server.address() as {port:number}).port;
  const path=join(root,'worker.json');await writeFile(path,JSON.stringify({service_url:`http://127.0.0.1:${port}`,worker_id:'fixture-worker',token_env:'WORKER_FIXTURE_TOKEN',artifact_dir:join(root,'artifacts'),targets:[{id:'fixture-local',account_id:'fixture-personal',provider,mode:'local',binary,auth_dir:join(root,'auth'),repositories:{'fixture-repo':{path:repo}}}]}));
  const child=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs',import.meta.url)),'src/worker.ts',path],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,WORKER_FIXTURE_TOKEN:'t'.repeat(40)},stdio:'ignore'});
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const result=await Promise.race([completed,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Worker did not finish fixture')),15000);})]);
   expect(result.state).toBe('succeeded');expect(result.patch).toContain('+after');expect(result.session_id).toBe('fixture-session');
   expect(await readFile(join(repo,'sample.txt'),'utf8')).toBe('before\n');
   expect(await readFile(join(root,'artifacts',id,'changes.patch'),'utf8')).toBe(result.patch);
  }finally{
   if(timer)clearTimeout(timer);child.kill('SIGTERM');await new Promise(r=>setTimeout(r,100));child.kill('SIGKILL');server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});
  }
 },20000);
});
