import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {connectSql} from '@llm-usage/db';
import {jobRequest,ingestSnapshot} from '@llm-usage/core';
import * as store from '../src/execution-store';
const enabled=process.env.RUN_DB_INTEGRATION==='1';
const schema=`execution_test_${process.pid}`;
const original=process.env.DATABASE_URL;
let sql:ReturnType<typeof connectSql>;
describe.skipIf(!enabled)('PostgreSQL execution lifecycle',()=>{
 beforeAll(async()=>{
  sql=connectSql();await sql.unsafe(`CREATE SCHEMA ${schema}`);
  const url=new URL(original!);url.searchParams.set('search_path',schema);process.env.DATABASE_URL=url.toString();
  const test=connectSql();try{
   for(const name of ['0001_initial.sql','0002_execution.sql'])await test.unsafe(await readFile(new URL(`../../../packages/db/migrations/${name}`,import.meta.url),'utf8'));
  }finally{await test.end();}
 });
 afterAll(async()=>{process.env.DATABASE_URL=original;await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`);await sql.end();});
 it('registers, enforces billing, deduplicates, leases one account and holds uncertain work',async()=>{
  await store.registerAccount({id:'test-personal',provider:'openai',label:'Test',account_type:'personal'});
  const registration={id:'test-local',account_id:'test-personal',worker_id:'test-worker',mode:'local' as const,repositories:['test-repo'],model_classes:[],setup_minutes:0,billing:'unknown' as const};
  await store.registerTarget(registration);
  await store.reportHealth('test-worker',{target_id:'test-local',health:'ready',cooldown_until:null});
  const request=jobRequest.parse({repository:'test-repo',prompt:'A test task'});
  expect((await store.planTask(request)).selected).toBeNull();
  await store.registerTarget({...registration,billing:'subscription'});
  await store.reportHealth('test-worker',{target_id:'test-local',health:'ready',cooldown_until:null});
  await expect(store.reportHealth('wrong-worker',{target_id:'test-local',health:'ready',cooldown_until:null})).rejects.toThrow('target_not_owned');
  const [first,retry]=await Promise.all([store.submitJob(request,'test-idempotency-123'),store.submitJob(request,'test-idempotency-123')]);
  expect(first.id).toBe(retry.id);
  await expect(store.submitJob({...request,prompt:'different'},'test-idempotency-123')).rejects.toThrow('idempotency_conflict');
  const second=await store.submitJob(request,'test-idempotency-456');
  const claims=await Promise.all([store.claimJob('test-worker'),store.claimJob('test-worker')]);
  expect(claims.filter(Boolean)).toHaveLength(1);const claim=claims.find(Boolean)!;
  const visible=await store.getJob(claim.id as string);expect(visible).not.toHaveProperty('lease_token');
  await expect(store.finishJob('wrong-worker',claim.id as string,claim.lease_token,{state:'succeeded',summary:'fake'})).rejects.toThrow('lease_lost');
  await store.cancelJob(claim.id as string);
  expect((await store.heartbeatJob('test-worker',claim.id as string,claim.lease_token)).cancel_requested).toBe(true);
  const test=connectSql();try{await test`UPDATE execution_jobs SET lease_until=now()-interval '1 second' WHERE id=${claim.id as string}`;}finally{await test.end();}
  expect(await store.claimJob('test-worker')).toBeNull();
  expect((await store.getJob(claim.id as string)).state).toBe('needs_review');
  await expect(store.finishJob('test-worker',claim.id as string,claim.lease_token,{state:'succeeded',summary:'late'})).rejects.toThrow('lease_lost');
  await store.resolveJob(claim.id as string,{state:'cancelled',summary:'Operator verified no task is running.'});
  const handoff=await store.planTask({...request,continue_job_id:claim.id as string});
  expect(handoff.selected).toBeNull();expect(handoff.steps.at(-1)?.step).toBe('handoff_required');
  const next=await store.claimJob('test-worker');expect(next).not.toBeNull();
  expect(next!.id).toBe(second.id===claim.id?first.id:second.id);
  await store.finishJob('test-worker',next!.id as string,next!.lease_token,{state:'succeeded',summary:'Done',session_id:'session-test'});
  const continued=await store.planTask({...request,continue_job_id:next!.id as string});expect(continued.selected?.continuation).toBe(true);
  const unavailable=await store.planTask({...request,continue_job_id:next!.id as string,execution:'cloud'});
  expect(unavailable.selected).toBeNull();expect(unavailable.steps.at(-1)?.step).toBe('handoff_required');
 });
 it('exposes collected quotas through MCP account data and stops trusting a failed refresh',async()=>{
  await store.registerAccount({id:'quota-personal',provider:'anthropic',label:'Quota fixture',account_type:'personal'});
  await store.registerTarget({id:'quota-local',account_id:'quota-personal',worker_id:'quota-worker',mode:'local',repositories:['quota-repo'],model_classes:[],setup_minutes:0,billing:'subscription'});
  await store.reportHealth('quota-worker',{target_id:'quota-local',health:'ready',cooldown_until:null});
  const observed=new Date().toISOString();
  await store.reportUsage('quota-worker',ingestSnapshot.parse({account_id:'quota-personal',provider:'anthropic',observed_at:observed,status:'ok',limits:[{
   id:'five_hour',account_id:'quota-personal',kind:'session',scope:'all_models',unit:'fraction',observed_at:observed,
   remaining_fraction:.8,used_fraction:.2,reset_at:new Date(Date.now()+3600000).toISOString(),source:'local_collector',confidence:'provider_reported'
  }]}));
  const listed=(await store.listExecutionAccounts()).accounts.find(a=>a.id==='quota-personal');
  expect(listed?.usage?.limits[0].remaining_fraction).toBe(.8);
  const request=jobRequest.parse({repository:'quota-repo',prompt:'Fixture'});
  expect((await store.planTask(request)).selected?.usage).toBe('measured');
  await store.reportUsage('quota-worker',ingestSnapshot.parse({account_id:'quota-personal',provider:'anthropic',observed_at:new Date(Date.now()+1).toISOString(),status:'error',limits:[],metadata:{diagnostic_code:'usage_auth_required'}}));
  const failed=(await store.listExecutionAccounts()).accounts.find(a=>a.id==='quota-personal');
  expect(failed?.usage?.usage_diagnostic).toBe('usage_auth_required');
  expect((await store.planTask(request)).selected?.usage).toBe('unknown');
 });

 it('persists concrete Cursor model/pool selection through claim and continuation',async()=>{
  await store.registerAccount({id:'pool-personal',provider:'cursor',label:'Pool fixture',account_type:'personal'});
  await store.registerTarget({id:'pool-local',account_id:'pool-personal',worker_id:'pool-worker',mode:'local',repositories:['pool-repo'],model_classes:['reasoning'],models:{reasoning:'sonnet-4'},setup_minutes:0,billing:'subscription'});
  await store.reportHealth('pool-worker',{target_id:'pool-local',health:'ready',cooldown_until:null});
  const observed=new Date().toISOString();
  await store.reportUsage('pool-worker',ingestSnapshot.parse({account_id:'pool-personal',provider:'cursor',observed_at:observed,status:'ok',limits:
   [['all_models',.915],['cursor_auto',.999],['cursor_api',0]].map(([scope,remaining])=>({id:String(scope),account_id:'pool-personal',kind:'subscription',scope,unit:'fraction',observed_at:observed,
    remaining_fraction:remaining,reset_at:new Date(Date.now()+3600000).toISOString(),source:'local_collector',confidence:'provider_reported'}))}));
  const request=jobRequest.parse({repository:'pool-repo',prompt:'Fixture'});
  expect((await store.planTask({...request,model_class:'reasoning'})).selected).toBeNull();
  await store.submitJob(request,'pool-idempotency-fixture');
  const claim=await store.claimJob('pool-worker');
  expect(claim?.decision).toMatchObject({selected:{model:'auto',quota_scope:'cursor_auto'}});
  await store.finishJob('pool-worker',claim!.id,claim!.lease_token,{state:'succeeded',summary:'Fixture',session_id:'pool-session'});
  expect((await store.planTask({...request,continue_job_id:claim!.id})).selected).toMatchObject({model:'auto',continuation:true});
 });

});
