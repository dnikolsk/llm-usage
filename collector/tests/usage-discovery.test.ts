import {afterEach,describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {discoverSavedWorkers} from '../src/usage-discovery';
import {inspectDashboard} from '../src/usage-doctor';

const roots:string[]=[];
async function fixture(){const root=await mkdtemp(join(tmpdir(),'usage-locate-'));roots.push(root);return root;}
const config={service_url:'https://control.example',worker_id:'worker-one',token_env:'PRIVATE_TOKEN_BINDING',artifact_dir:'/jobs',
 targets:[{id:'claude-local',account_id:'claude-personal',provider:'anthropic',mode:'local',binary:'/should-not-execute',auth_dir:'/private-auth',repositories:{}}]};
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});

describe('worker discovery without a visible running worker',()=>{
 it('finds valid saved configs while excluding examples, secrets, auth profiles and diagnostic clones',async()=>{
  const root=await fixture();
  for(const directory of ['state','node_modules/package','accounts/claude','llm-usage-diagnostic.abcdef']){
   await mkdir(join(root,directory),{recursive:true});await writeFile(join(root,directory,'worker.json'),JSON.stringify(config));
  }
  for(const name of ['worker.personal.example.json','worker-secrets.json'])await writeFile(join(root,'state',name),JSON.stringify(config));
  await writeFile(join(root,'state','worker-invalid.json'),'{"token":"DO_NOT_PRINT"}');
  const report=await discoverSavedWorkers({roots:[root]});
  expect(report.candidates).toEqual([{path:join(root,'state','worker.json'),worker_id:'worker-one',service_origin:'https://control.example',providers:['anthropic'],service_references:[]}]);
  expect(report.invalid_config_candidates).toBe(1);
  expect(JSON.stringify(report)).not.toContain('DO_NOT_PRINT');expect(JSON.stringify(report)).not.toContain('PRIVATE_TOKEN_BINDING');
 });
 it('follows static systemd launcher references without sourcing secrets or executing the launcher',async()=>{
  const root=await fixture();await mkdir(join(root,'units'));await mkdir(join(root,'state'));
  const file=join(root,'state','worker.json'),launcher=join(root,'start-worker.sh'),marker=join(root,'executed');
  await writeFile(file,JSON.stringify(config));
  await writeFile(launcher,`#!/bin/sh\nsource '${join(root,'secret.env')}'\ntouch '${marker}'\nexec pnpm worker '${file}'\n`);
  const unit=join(root,'units','llm-worker.service');
  await writeFile(unit,`[Service]\nEnvironment=TOKEN=DO_NOT_PRINT_SECRET\nExecStart=/bin/bash "${launcher}"\n`);
  const report=await discoverSavedWorkers({roots:[join(root,'units')]});
  expect(report.candidates[0].service_references).toEqual([unit]);
  expect(report.services).toEqual([{path:unit,launchers:[launcher],worker_configs:[file]}]);
  await expect(access(marker)).rejects.toThrow();
  expect(JSON.stringify(report)).not.toContain('DO_NOT_PRINT_SECRET');
  expect(JSON.stringify(report)).not.toContain('secret.env');
 });
 it('resolves home placeholders and canonicalizes config symlinks without selecting between different configs',async()=>{
  const root=await fixture();await mkdir(join(root,'units'));
  await writeFile(join(root,'worker.json'),JSON.stringify(config));
  await symlink(join(root,'worker.json'),join(root,'worker-link.json'));
  await writeFile(join(root,'worker-other.json'),JSON.stringify({...config,worker_id:'worker-two'}));
  await writeFile(join(root,'units','llm-worker.service'),'[Service]\nExecStart=node /app/worker.js %h/worker.json\n');
  const report=await discoverSavedWorkers({roots:[root],home:root});
  expect(report.candidates).toHaveLength(2);
  expect(report.candidates.find(candidate=>candidate.worker_id==='worker-one')?.service_references).toEqual([join(root,'units','llm-worker.service')]);
 });
 it('reports bounded and missing searches rather than claiming the machine has no worker',async()=>{
  const root=await fixture();await mkdir(join(root,'deeper'));await writeFile(join(root,'deeper','worker.json'),JSON.stringify(config));
  const depth=await discoverSavedWorkers({roots:[root],maxDepth:0});
  expect(depth.status).toBe('bounded_search_incomplete');expect(depth.candidates).toHaveLength(0);
  const capped=await discoverSavedWorkers({roots:[root],maxEntries:1});
  expect(capped.status).toBe('bounded_search_incomplete');
  const missing=await discoverSavedWorkers({roots:[join(root,'missing')]});
  expect(missing.scans[0].status).toBe('missing_or_unreadable');
 });
 it('can inspect the dashboard without requiring a worker config',async()=>{
  const report=await inspectDashboard('https://dashboard.example','DASHBOARD_READ_TOKEN',{
   env:{DASHBOARD_READ_TOKEN:'r'.repeat(32)},fetch:async(url,options)=>{
    expect(String(url)).toBe('https://dashboard.example/v1/status');expect(options?.method).toBe('GET');
    return Response.json({accounts:[]});
   }});
  expect(report).toEqual({origin:'https://dashboard.example',status:'ok',accounts:[]});
 });
 it.each([false,true])('emits machine identity and selects a saved config only with a service reference (%s)',async referenced=>{
  const root=await fixture(),output=join(root,'report.json');await writeFile(join(root,'worker.json'),JSON.stringify(config));
  if(referenced)await writeFile(join(root,'llm-worker.service'),`[Service]\nExecStart=node /app/worker.js ${join(root,'worker.json')}\n`);
  const result=await new Promise<{code:number|null;stdout:string}>((resolve,reject)=>{
   const child=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs',import.meta.url)),'src/usage-doctor-cli.ts','--discover',
    '--search-root',root,'--dashboard','https://dashboard.example','--output',output],{
      cwd:fileURLToPath(new URL('..',import.meta.url)),env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});
   let stdout='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.resume();child.on('error',reject);child.on('close',code=>resolve({code,stdout}));
  });
  expect(result.code).toBe(2);
  const report=JSON.parse(await readFile(output,'utf8'));
  expect(report.version).toBe(2);expect(report.machine).toMatchObject({uid:process.getuid?.(),platform:process.platform});
  expect(report.discovery.candidates).toContainEqual(expect.objectContaining({path:join(root,'worker.json')}));
  if(referenced)expect(report.worker_config).toBe(join(root,'worker.json'));
  else expect(report.checks).toContainEqual({status:'blocked',code:'worker_config_requires_selection'});
  expect(report.dashboard.status).toBe('token_missing');
 });
});
