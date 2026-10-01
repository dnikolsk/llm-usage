import {afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeUsage as claude,readUsage as readClaude} from '../src/providers/claude/usage';
import {normalizeUsage as cursor,readUsage as readCursor} from '../src/providers/cursor/usage';
import {collectUsage} from '../src/usage';
import {usageJson} from '../src/providers/usage-http';
import type {Target} from '../src/providers/types';
const now=new Date('2026-10-01T12:00:00Z');
const reset='2026-10-01T18:00:00Z';
const claudeRaw={five_hour:{utilization:72,resets_at:reset},seven_day:{utilization:91,resets_at:'2026-10-05T00:00:00+00:00'},seven_day_sonnet:{utilization:20,resets_at:reset},extra_usage:{is_enabled:true,monthly_limit:10000,used_credits:0}};
const cursorRaw={billingCycleStart:String(+now-86400000),billingCycleEnd:String(+now+86400000),planUsage:{totalPercentUsed:75,limit:2000,includedSpend:1500,autoPercentUsed:30,apiPercentUsed:80},spendLimitUsage:{individualRemaining:999999}};
afterEach(()=>vi.unstubAllGlobals());
describe('provider usage normalization',()=>{
 it('keeps Claude session and weekly bottlenecks, scopes and UTC resets; excludes extra usage',()=>{
  const s=claude(claudeRaw,'claude-personal',now).snapshot;
  expect(s.limits).toHaveLength(3);expect(s.limits[0].remaining_fraction).toBeCloseTo(.28);
  expect(s.limits[1].remaining_fraction).toBeCloseTo(.09);expect(s.limits[1].reset_at).toBe('2026-10-05T00:00:00.000Z');
  expect(s.limits[2].scope).toBe('sonnet');expect(s.status).toBe('ok');
 });
 it('does not turn null or malformed Claude usage into full quota',()=>{
  expect(()=>claude({five_hour:null,seven_day:null},'claude-personal',now)).toThrow();
  expect(()=>claude({five_hour:{utilization:'0',resets_at:reset}},'claude-personal',now)).toThrow();
  expect(claude({five_hour:{utilization:105,resets_at:null}},'claude-personal',now).snapshot.limits[0].remaining_fraction).toBe(0);
 });
 it('uses Cursor included usage, preserves separate pools, and ignores paid credits',()=>{
  const s=cursor(cursorRaw,'cursor-personal',now).snapshot;
  expect(s.limits[0]).toMatchObject({remaining_fraction:.25,limit:2000,used:1500,remaining:500,unit:'usd_cents',reset_at:'2026-10-02T12:00:00.000Z'});
  expect(s.limits.map(b=>b.scope)).toEqual(['all_models','cursor_auto','cursor_api']);
 });
 it('uses an explicit included-allowance reset instead of a later billing renewal',()=>{
  const s=cursor(cursorRaw,'cursor-personal',now,{planInfo:{includedUsageResetsAt:String(+now+3600000),includedUsagePeriod:'WEEKLY'}}).snapshot;
  expect(s.limits[0]).toMatchObject({kind:'weekly',reset_at:'2026-10-01T13:00:00.000Z',window_started_at:null});
 });
 it('supports amount-only Cursor usage but rejects missing limits and reset dates',()=>{
  expect(cursor({...cursorRaw,planUsage:{limit:100,includedSpend:25}},'cursor-personal',now).snapshot.limits[0].remaining_fraction).toBe(.75);
  expect(()=>cursor({...cursorRaw,planUsage:{},spendLimitUsage:{individualRemaining:100}},'cursor-personal',now)).toThrow();
  expect(()=>cursor({...cursorRaw,billingCycleEnd:undefined},'cursor-personal',now)).toThrow();
 });
 it('reads only account-local credentials, calls fixed endpoints, and never returns credentials',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'quota-test-'));
  try{
   await writeFile(join(dir,'.credentials.json'),JSON.stringify({claudeAiOauth:{accessToken:'test-claude-secret',expiresAt:+now+999999999999}}));
   await mkdir(join(dir,'config','cursor'),{recursive:true});
   await writeFile(join(dir,'config','cursor','auth.json'),JSON.stringify({accessToken:'test-cursor-secret'}));
   const fetch=vi.fn(async(url:string,init:RequestInit)=>{
    expect(init.redirect).toBe('error');
    if(url.includes('anthropic.com')){expect(init.headers).toMatchObject({Authorization:'Bearer test-claude-secret'});return Response.json(claudeRaw);}
    expect(url.startsWith('https://api2.cursor.sh/aiserver.v1.DashboardService/')).toBe(true);
    expect(init.headers).toMatchObject({Authorization:'Bearer test-cursor-secret'});
    return Response.json(url.endsWith('GetPlanInfo')?{}:cursorRaw);
   });vi.stubGlobal('fetch',fetch);
   const c=await readClaude({auth_dir:dir,account_id:'claude-personal'} as Target);
   const u=await readCursor({auth_dir:dir,account_id:'cursor-personal'} as Target);
   expect(fetch).toHaveBeenCalledTimes(3);expect(JSON.stringify([c,u])).not.toContain('secret');
   vi.stubGlobal('fetch',async()=>new Response('sensitive-error-body',{status:401}));
   const error=await collectUsage({auth_dir:dir,account_id:'cursor-personal',provider:'cursor'} as Target);
   expect(error.snapshot).toMatchObject({status:'error',limits:[],metadata:{diagnostic_code:'usage_auth_required'}});
   expect(JSON.stringify(error)).not.toContain('sensitive');
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('bounds responses and distinguishes throttling without logging response bodies',async()=>{
  vi.stubGlobal('fetch',async()=>new Response('x'.repeat(262145)));
  await expect(usageJson('https://api.anthropic.com/api/oauth/usage',{})).rejects.toThrow('usage_response_too_large');
  vi.stubGlobal('fetch',async()=>new Response('private',{status:429}));
  await expect(usageJson('https://api.anthropic.com/api/oauth/usage',{})).rejects.toThrow('usage_rate_limited');
 });
});

describe('conflicting Cursor amounts',()=>{
 it('retains reported percentages while omitting contradictory monetary balances',()=>{
  const snapshot=cursor({...cursorRaw,planUsage:{...cursorRaw.planUsage,limit:7000,includedSpend:7000,totalPercentUsed:8.5}},'cursor-personal',now).snapshot;
  expect(snapshot.limits[0]).toMatchObject({remaining_fraction:.915,unit:'fraction',used:null,limit:null,remaining:null,metadata:{diagnostic_code:'usage_amount_percentage_conflict'}});
 });
});
