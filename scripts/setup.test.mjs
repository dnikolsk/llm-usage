import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {initialize} from './setup.mjs';

test('setup creates independent private role bindings, reuses injected secrets and refuses rotation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'owner-setup-')),output=join(dir,'roles');
 try{
  const supplied='provided'.repeat(8);
  const result=await initialize(['--directory',output,'--worker-id','my-host'],{JOB_TOKEN:supplied,DATABASE_URL:'postgresql://user:password@localhost/test'});
  const web=JSON.parse(await readFile(join(output,'web-secrets.json'),'utf8')).variables;
  const worker=JSON.parse(await readFile(join(output,'worker-secrets.json'),'utf8')).variables;
  assert.equal(web.JOB_TOKEN,supplied);assert.equal(web.WORKER_MY_HOST_TOKEN,worker.WORKER_MY_HOST_TOKEN);
  assert.deepEqual(Object.keys(worker),['WORKER_MY_HOST_TOKEN']);assert.equal(new Set(Object.values(web)).size,Object.keys(web).length);
  assert.equal(result.database_configured,true);assert.equal((await stat(output)).mode&0o777,0o700);
  assert.equal((await stat(join(output,'web-secrets.json'))).mode&0o777,0o600);
  await assert.rejects(initialize(['--directory',output],{}),{code:'EEXIST'});assert.equal(JSON.parse(await readFile(join(output,'web-secrets.json'),'utf8')).variables.JOB_TOKEN,supplied);
  await assert.rejects(initialize(['--directory',join(dir,'bad')],{READ_TOKEN:'short'}),/Existing READ_TOKEN/);
  await assert.rejects(initialize(['--directory',join(dir,'bad')],{READ_TOKEN:supplied,WRITE_TOKEN:supplied}),/independent/);
  await assert.rejects(initialize(['--directory',resolve('.llm-usage')],{}),/outside/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('CLI prints no secret values and role runner isolates unrelated inherited credentials',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'owner-run-')),output=join(dir,'roles');
 try{
  const script=resolve('scripts/setup.mjs');
  const init=spawnSync(process.execPath,[script,'init','--directory',output],{env:{PATH:process.env.PATH},encoding:'utf8'});
  assert.equal(init.status,0,init.stderr);
  const worker=JSON.parse(await readFile(join(output,'worker-secrets.json'),'utf8')).variables;
  assert.equal(init.stdout.includes(worker.WORKER_WORKER_1_TOKEN),false);
  const check=join(dir,'check.cjs');
  await writeFile(check,`const assert=require('node:assert/strict');assert.equal(process.env.WORKER_WORKER_1_TOKEN,${JSON.stringify(worker.WORKER_WORKER_1_TOKEN)});for(const key of ['DATABASE_URL','ADMIN_TOKEN','JOB_TOKEN','OP_SERVICE_ACCOUNT_TOKEN','OPENAI_API_KEY'])assert.equal(process.env[key],undefined);process.exit(7);`);
  const result=spawnSync(process.execPath,[script,'run','--file',join(output,'worker-secrets.json'),'--',process.execPath,check],{env:{PATH:process.env.PATH,ADMIN_TOKEN:'admin',DATABASE_URL:'db',JOB_TOKEN:'bot',OP_SERVICE_ACCOUNT_TOKEN:'vault',OPENAI_API_KEY:'api'},encoding:'utf8'});
  assert.equal(result.status,7,result.stderr);
  await writeFile(join(output,'worker-secrets.json'),JSON.stringify({role:'worker',variables:{ADMIN_TOKEN:'bad'}}));
  const bad=spawnSync(process.execPath,[script,'run','--file',join(output,'worker-secrets.json'),'--',process.execPath,check],{encoding:'utf8'});assert.equal(bad.status,1);assert.equal(bad.stderr.includes('bad'),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
