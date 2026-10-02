import {describe,it,expect} from 'vitest';
import {decideExecution,taskSpec,type ExecutionAccount,type ExecutionTarget} from '../src/index';
const now=new Date('2026-10-01T12:00:00Z');
const task=taskSpec.parse({repository:'test-repo'});
function account(id:string,remaining=.7,hours=2):ExecutionAccount{return{
  id,provider:'openai',label:id,plan:null,account_type:'personal',enabled:true,capabilities:['coding'],model_classes:[],priority:0,
  status:'available',freshness:'fresh',observed_at:now.toISOString(),latest_refresh_at:now.toISOString(),
  limits:[{id:'session',account_id:id,kind:'session',scope:'all_models',unit:'fraction',window_seconds:18000,used:null,limit:null,remaining:null,
    used_fraction:1-remaining,remaining_fraction:remaining,window_started_at:null,reset_at:new Date(+now+hours*3600000).toISOString(),
    observed_at:now.toISOString(),source:'official_api',confidence:'provider_reported',metadata:{}}]};}
function target(id:string,overrides:Partial<ExecutionTarget>={}):ExecutionTarget{return{
 id:id+'-local',account_id:id,worker_id:'worker-one',mode:'local',repositories:['test-repo'],model_classes:[],setup_minutes:0,
 billing:'subscription',health:'ready',observed_at:now.toISOString(),cooldown_until:null,busy:false,...overrides};}
const decide=(accounts:ExecutionAccount[],targets:ExecutionTarget[],request=task)=>decideExecution(accounts,targets,request,{now});
describe('execution decision stages',()=>{
 it('honors provider overrides and never silently falls back',()=>{
  const a=account('codex');expect(decide([a],[target(a.id)],{...task,provider:'anthropic'}).selected).toBeNull();
 });
 it('keeps personal and work pools separate',()=>{
  const a={...account('work'),account_type:'work'};expect(decide([a],[target(a.id)]).selected).toBeNull();
 });
 it('requires fresh worker health, verified billing and a free account lease',()=>{
  const a=account('codex');for(const override of [{health:'needs_login' as const},{billing:'paid' as const},{billing:'unknown' as const},{busy:true},{observed_at:new Date(+now-121000).toISOString()}]){
   expect(decide([a],[target(a.id,override)]).selected).toBeNull();
  }
 });
 it('uses the provider with more usable capacity before imminent reset',()=>{
  expect(decide([account('soon',.4,.2),account('ample',.8,4)],[target('soon'),target('ample')]).selected?.account_id).toBe('ample');
 });
 it('uses reset time to spend comparable available quota before it expires',()=>{
  const result=decide([account('soon',.7,1),account('later',.74,5)],[target('soon'),target('later')]);
  expect(result.selected?.account_id).toBe('soon');expect(result.selected?.seconds_until_reset).toBe(3600);
  expect(result.steps.map(s=>s.step)).toContain('reset_opportunity');
 });
 it('keeps a weekly bottleneck in both capacity and reset pressure',()=>{
  const a=account('soon',.9,.1),b=account('later',.7,4);
  a.limits.push({...a.limits[0],id:'weekly',kind:'weekly',remaining_fraction:.16,reset_at:new Date(+now+7*86400000).toISOString()});
  expect(decide([a,b],[target(a.id),target(b.id)]).selected?.account_id).toBe('later');
 });
 it('never replenishes quota just because a reported reset passed',()=>{
  const a=account('expired',0,-1);const result=decide([a],[target(a.id)]);
  expect(result.selected?.usage).toBe('unknown');expect(result.selected?.remaining_fraction).toBeNull();
  expect(result.selected?.warnings).toContain('reset_passed_recheck_on_use');
 });
 it('holds known exhausted quota until reset even if the observation is stale',()=>{
  const a=account('empty',0,2);a.limits[0].observed_at=new Date(+now-3600000).toISOString();
  expect(decide([a],[target(a.id)]).selected).toBeNull();
 });
 it('unknown quota is eligible but loses to fresh measured capacity',()=>{
  const a=account('unknown');a.limits=[];
  expect(decide([a],[target(a.id)]).selected?.usage).toBe('unknown');
  expect(decide([a,account('known')],[target(a.id),target('known')]).selected?.account_id).toBe('known');
 });
 it('reports failed telemetry as unknown while retaining a known exhaustion',()=>{
  const a={...account('failed'),status:'error' as const,usage_diagnostic:'usage_auth_required'};
  const c=decide([a],[target(a.id)]).selected;
  expect(c?.usage).toBe('unknown');expect(c?.warnings).toContain('usage_collection_failed');
  expect(c?.warnings).toContain('usage_auth_required');expect(c?.buckets[0].observed_at).toBe(now.toISOString());
  a.limits[0].remaining_fraction=0;expect(decide([a],[target(a.id)]).selected).toBeNull();
 });
 it('compares measured Claude and Cursor capacity with Codex instead of favoring its telemetry',()=>{
  const a={...account('claude',.8),provider:'anthropic'},b={...account('cursor',.7),provider:'cursor'},c=account('codex',.14);
  expect(decide([a,b,c],[target(a.id),target(b.id),target(c.id)]).selected?.account_id).toBe('claude');
 });
 it('preserves a verified continuation on cloud instead of switching to a fresh local workspace',()=>{
  const a=account('first',.3),b=account('second',.9);const cloud=target('first',{id:'first-cloud',mode:'cloud'});
  const result=decideExecution([a,b],[cloud,target('second')],task,{now,continuation:{target_id:cloud.id,account_id:a.id,repository:task.repository,resumable:true}});
  expect(result.selected?.target_id).toBe(cloud.id);
 });
 it('continuation cannot bypass an explicit local override or quota reserve',()=>{
  const a=account('first',.05);const cloud=target('first',{mode:'cloud'});
  const result=decideExecution([a],[cloud],{...task,execution:'local'},{now,continuation:{target_id:cloud.id,account_id:a.id,repository:task.repository,resumable:true}});
  expect(result.selected).toBeNull();
 });
 it('chooses prepared cloud setup over an unprepared local worker',()=>{
  const a=account('account');const result=decide([a],[target(a.id,{setup_minutes:20}),target(a.id,{id:'account-cloud',mode:'cloud'})]);
  expect(result.selected?.execution).toBe('cloud');
 });
 it('produces stable decisions independent of enumeration order',()=>{
  const accounts=[account('aa',.70,3),account('bb',.74,2),account('cc',.78,1)];const targets=accounts.map(a=>target(a.id));
  expect(decide(accounts,targets).selected?.target_id).toBe(decide([...accounts].reverse(),[...targets].reverse()).selected?.target_id);
 });
 it('does not pretend model-specific quota applies to every model',()=>{
  const a=account('specific');a.limits[0].scope='special-model';expect(decide([a],[target(a.id)]).selected?.usage).toBe('unknown');
 });
 it('binds Cursor Auto to its own pool and excludes exhausted named-model pools',()=>{
  const a={...account('cursor',.915),provider:'cursor'};
  a.limits.push({...a.limits[0],id:'auto',scope:'cursor_auto',remaining_fraction:.999},
    {...a.limits[0],id:'api',scope:'cursor_api',remaining_fraction:0});
  const t=target(a.id,{model_classes:['reasoning'],models:{reasoning:'sonnet-4'}});
  const automatic=decide([a],[t]);
  expect(automatic.selected).toMatchObject({model:'auto',quota_scope:'cursor_auto',remaining_fraction:.915});
  expect(automatic.selected?.buckets.map(b=>b.scope)).toEqual(['all_models','cursor_auto']);
  const named=decide([a],[t],{...task,model_class:'reasoning'});
  expect(named.selected).toBeNull();expect(named.candidates[0].exclusions).toContain('exhausted:session');
  a.limits[1].remaining_fraction=0;expect(decide([a],[t]).selected).toBeNull();
 });
 it('does not route Cursor on aggregate quota when the selected pool is missing',()=>{
  const a={...account('cursor',.915),provider:'cursor'};
  expect(decide([a],[target(a.id)]).candidates[0].exclusions).toContain('model_pool_capacity_unknown');
 });
 it('uses concrete Claude model scopes behind generic configured class labels',()=>{
  const a={...account('claude',.9),provider:'anthropic'};
  a.limits.push({...a.limits[0],id:'opus',scope:'opus',remaining_fraction:0});
  const t=target(a.id,{models:{reasoning:'claude-opus-4'},model_classes:['reasoning'],default_model:'sonnet'});
  expect(decide([a],[t]).selected?.model).toBe('sonnet');
  expect(decide([a],[t],{...task,model_class:'reasoning'}).selected).toBeNull();
 });
 it('retains the Cursor continuation pool and requires handoff instead of silently changing it',()=>{
  const a={...account('cursor',.9),provider:'cursor'};
  a.limits.push({...a.limits[0],id:'auto',scope:'cursor_auto',remaining_fraction:.9},{...a.limits[0],id:'api',scope:'cursor_api',remaining_fraction:0});
  const t=target(a.id);
  const r=decideExecution([a],[t],task,{now,continuation:{target_id:t.id,account_id:a.id,repository:task.repository,resumable:true,model:'sonnet-4'}});
  expect(r.selected).toBeNull();expect(r.candidates[0].quota_scope).toBe('cursor_api');
 });
 it('surfaces conflicting quota amounts in the routing explanation',()=>{
  const a=account('codex');a.limits[0].metadata={diagnostic_code:'usage_amount_percentage_conflict'};
  expect(decide([a],[target(a.id)]).selected?.warnings).toContain('usage_amount_percentage_conflict');
 });

});
