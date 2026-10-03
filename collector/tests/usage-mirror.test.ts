import {describe,it,expect,vi} from 'vitest';
import {ingestSnapshot} from '@llm-usage/core';
import {workerConfig} from '../src/providers/types';
import {normalizeUsage as claude} from '../src/providers/claude/usage';
import {createUsageMirror} from '../src/usage-mirror';

const config=workerConfig.parse({service_url:'https://control.example',worker_id:'worker-1',token_env:'WORKER_TOKEN',artifact_dir:'/jobs',
  targets:[{id:'claude-local',account_id:'claude-personal',provider:'anthropic',mode:'local',binary:'/bin/claude',auth_dir:'/auth/claude',repositories:{}}],
  usage_mirror:{service_url:'https://dashboard.example',token_env:'DASHBOARD_WRITE_TOKEN',account_ids:{'claude-personal':'claude-dashboard'}}});
const env={WORKER_TOKEN:'w'.repeat(32),DASHBOARD_WRITE_TOKEN:'d'.repeat(32)};
const snapshot=claude({five_hour:{utilization:0,resets_at:null},seven_day:{utilization:37,resets_at:'2026-10-04T01:00:00-04:00'},
  extra_usage:{is_enabled:true,monthly_limit:10000,used_credits:2500}},'claude-personal',new Date('2026-10-03T12:00:00Z')).snapshot;

describe('separate dashboard publication',()=>{
 it('preserves provider reset dates, paid telemetry, diagnostics and account identity through the ingest contract',async()=>{
  const send=vi.fn(async()=>Response.json({result:'created'},{status:201}));
  const mirror=createUsageMirror(config,{env,fetch:send});
  expect(await mirror(snapshot)).toBe(true);
  const [url,request]=send.mock.calls[0] as unknown as [URL,RequestInit];
  expect(String(url)).toBe('https://dashboard.example/v1/ingest');
  expect(request.redirect).toBe('error');
  expect(request.headers).toMatchObject({Authorization:`Bearer ${env.DASHBOARD_WRITE_TOKEN}`});
  const actual=ingestSnapshot.parse(JSON.parse(String(request.body)));
  expect(actual.account_id).toBe('claude-dashboard');
  expect(actual.limits.every(bucket=>bucket.account_id==='claude-dashboard')).toBe(true);
  expect(actual.limits.map(bucket=>bucket.reset_at)).toEqual([null,'2026-10-04T05:00:00.000Z']);
  expect(actual.metadata).toEqual(snapshot.metadata);
  expect(actual.metadata.paid_usage?.[0]).toMatchObject({remaining:7500,unit:'usd_cents'});
  expect(snapshot.account_id).toBe('claude-personal');
  expect(String(request.body)).not.toContain(env.WORKER_TOKEN);
 });
 it('uses a stable idempotency key when republishing the same observation',async()=>{
  const send=vi.fn(async()=>Response.json({result:'duplicate'}));
  const mirror=createUsageMirror(config,{env,fetch:send});
  expect(await mirror(snapshot)).toBe(true);expect(await mirror(snapshot)).toBe(true);
  const headers=send.mock.calls.map(call=>(call as unknown as [URL,RequestInit])[1].headers as Record<string,string>);
  expect(headers[0]['Idempotency-Key']).toMatch(/^[a-f0-9]{64}$/);
  expect(headers[1]['Idempotency-Key']).toBe(headers[0]['Idempotency-Key']);
 });
 it('publishes errors so the dashboard marks the last successful values as stale',async()=>{
  const send=vi.fn(async()=>Response.json({result:'created'}));
  const error=ingestSnapshot.parse({...snapshot,status:'error',limits:[],metadata:{diagnostic_code:'usage_auth_required'}});
  expect(await createUsageMirror(config,{env,fetch:send})(error)).toBe(true);
  const body=JSON.parse(String((send.mock.calls[0] as unknown as [URL,RequestInit])[1].body));
  expect(body).toMatchObject({status:'error',limits:[],metadata:{diagnostic_code:'usage_auth_required'}});
 });
 it.each([401,404,429,503])('reports HTTP %s without exposing the response or stopping the worker',async status=>{
  const warn=vi.fn();const send=vi.fn(async()=>new Response('private server details',{status}));
  expect(await createUsageMirror(config,{env,fetch:send,warn})(snapshot)).toBe(false);
  expect(warn).toHaveBeenCalledWith(`Dashboard usage publication failed: HTTP ${status}.`);
 });
 it('does not treat an HTML login page or unrelated JSON as successful ingestion',async()=>{
  for(const response of [new Response('<html>private login</html>'),Response.json({ok:true})]){
   const warn=vi.fn();
   expect(await createUsageMirror(config,{env,fetch:async()=>response,warn})(snapshot)).toBe(false);
   expect(JSON.stringify(warn.mock.calls)).not.toContain('private login');
  }
 });
 it('contains network errors without logging credentials from the exception',async()=>{
  const warn=vi.fn();
  expect(await createUsageMirror(config,{env,fetch:async()=>{throw new Error(env.DASHBOARD_WRITE_TOKEN);},warn})(snapshot)).toBe(false);
  expect(JSON.stringify(warn.mock.calls)).not.toContain(env.DASHBOARD_WRITE_TOKEN);
 });
 it('leaves single-service workers unchanged when no mirror is configured',async()=>{
  const send=vi.fn();
  expect(await createUsageMirror({...config,usage_mirror:undefined},{env:{},fetch:send})(snapshot)).toBe(true);
  expect(send).not.toHaveBeenCalled();
 });
 it('rejects unsafe destinations, missing credentials and shared worker credentials before starting',()=>{
  for(const service_url of ['http://dashboard.example','https://user:password@dashboard.example','https://dashboard.example?token=private']){
   expect(()=>createUsageMirror({...config,usage_mirror:{...config.usage_mirror!,service_url}},{env})).toThrow('usage_mirror_https_required');
  }
  expect(()=>createUsageMirror(config,{env:{}})).toThrow('usage_mirror_write_token_required');
  expect(()=>createUsageMirror(config,{env:{...env,DASHBOARD_WRITE_TOKEN:env.WORKER_TOKEN}})).toThrow('usage_mirror_independent_token_required');
 });
 it('rejects account mapping typos and combining different accounts under one dashboard identity',()=>{
  expect(()=>createUsageMirror({...config,usage_mirror:{...config.usage_mirror!,account_ids:{unknown:'claude-dashboard'}}},{env})).toThrow('usage_mirror_unknown_account');
  expect(()=>createUsageMirror({...config,targets:[...config.targets,{...config.targets[0],account_id:'claude-dashboard'}]},{env})).toThrow('usage_mirror_duplicate_account');
 });
});
