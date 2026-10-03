import {describe,it,expect,vi} from 'vitest';
import {claude,codex,cursor,observerFor,diagnosticCode} from '../src/index';
import {normalizeUsage as claudeUsage} from '../src/claude';
import {normalizeUsage as codexUsage} from '../src/codex';
import {normalizeUsage as cursorUsage} from '../src/cursor';
import type {Grant} from '../src/types';

const now=new Date('2026-10-01T12:00:00Z');const clock=()=>now.getTime();
const random=(n:number)=>Buffer.alloc(n,7);
const jwt=(payload:Record<string,unknown>)=>`h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
const fetchJson=(handler:(url:string,init:RequestInit)=>unknown|Response)=>vi.fn(async(url:string,init:RequestInit)=>{
  const result=handler(url,init);return result instanceof Response?result:Response.json(result);
}) as unknown as typeof fetch;

describe('observer registry',()=>{
 it('maps provider names and rejects unknown providers',()=>{
  expect(observerFor('anthropic')).toBe(claude);expect(observerFor('openai')).toBe(codex);expect(observerFor('cursor')).toBe(cursor);expect(observerFor('mistral')).toBeNull();
 });
 it('maps only known diagnostics',()=>{expect(diagnosticCode(new Error('usage_rate_limited'))).toBe('usage_rate_limited');expect(diagnosticCode(new Error('ECONNRESET secret'))).toBe('usage_unavailable');});
});

describe('Claude observer',()=>{
 it('starts a PKCE flow against the public Claude Code client',()=>{
  const begun=claude.begin({random});const url=new URL(begun.authorization_url);
  expect(url.origin+url.pathname).toBe('https://claude.ai/oauth/authorize');
  expect(url.searchParams.get('client_id')).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');expect(url.searchParams.get('state')).toBe(begun.pending.state);
  expect(begun.pending.verifier.length).toBeGreaterThanOrEqual(43);
 });
 it('exchanges code#state, refreshes, reads usage and emits a store without refresh material',async()=>{
  const begun=claude.begin({random});
  const send=fetchJson((url,init)=>{
   const body=JSON.parse(init.body as string);
   if(url==='https://console.anthropic.com/v1/oauth/token'&&body.grant_type==='authorization_code'){
    expect(body).toMatchObject({code:'abc',state:begun.pending.state,code_verifier:begun.pending.verifier,client_id:'9d1c250a-e61b-44d9-88ed-5944d1962f5e'});
    return{access_token:'a1',refresh_token:'r1',expires_in:28800,scope:'user:inference user:profile'};
   }
   if(body.grant_type==='refresh_token'){expect(body.refresh_token).toBe('r1');return{access_token:'a2',refresh_token:'r2',expires_in:28800};}
   throw new Error('unexpected');
  });
  const granted=await claude.complete(begun.pending,` abc#${begun.pending.state} `,{fetch:send,now:clock});
  expect(granted).toMatchObject({access_token:'a1',refresh_token:'r1',expires_at:clock()+28_800_000});
  await expect(claude.complete(begun.pending,'abc#other',{fetch:send,now:clock})).rejects.toThrow('enrollment_state_mismatch');
  const refreshed=await claude.refresh(granted,{fetch:send,now:clock});
  expect(refreshed).toMatchObject({access_token:'a2',refresh_token:'r2'});
  const usage=fetchJson((url,init)=>{expect(url).toBe('https://api.anthropic.com/api/oauth/usage');expect((init.headers as Record<string,string>).Authorization).toBe('Bearer a2');
   return{five_hour:{utilization:72,resets_at:'2026-10-01T18:00:00Z'},seven_day:{utilization:91,resets_at:'2026-10-05T00:00:00+00:00'}};});
  const reading=await claude.readUsage(refreshed,'claude-personal',{fetch:usage,now:clock});
  expect(reading.snapshot.limits.map(b=>[b.kind,b.reset_at,Number(b.remaining_fraction!.toFixed(2))])).toEqual([['session','2026-10-01T18:00:00.000Z',0.28],['weekly','2026-10-05T00:00:00.000Z',0.09]]);
  const [file]=claude.credentialFiles(refreshed,'linux');
  expect(file.path).toBe('.credentials.json');
  expect(JSON.parse(file.content)).toEqual({claudeAiOauth:{accessToken:'a2',expiresAt:clock()+28_800_000,scopes:['user:inference','user:profile']}});
  expect(file.content).not.toContain('r2');
 });
 it('reports a rejected refresh as an authorization problem and never forwards response bodies',async()=>{
  const send=vi.fn(async()=>new Response('{"error":"invalid_grant","hint":"secret"}',{status:400})) as unknown as typeof fetch;
  await expect(claude.refresh({access_token:'a',refresh_token:'r',expires_at:null,claims:{},extra_tokens:{}},{fetch:send})).rejects.toThrow('enrollment_rejected');
  await expect(claude.refresh({access_token:'a',refresh_token:null,expires_at:null,claims:{},extra_tokens:{}},{fetch:send})).rejects.toThrow('usage_auth_required');
 });
 it('keeps reset semantics: missing five-hour reset stays null and utilization caps at 100%',()=>{
  expect(claudeUsage({five_hour:{utilization:105,resets_at:null},seven_day:{utilization:0,resets_at:'2026-10-05T00:00:00Z'}},'claude-c',now).snapshot.limits[0]).toMatchObject({remaining_fraction:0,reset_at:null});
  expect(()=>claudeUsage({five_hour:null,seven_day:null},'claude-c',now)).toThrow('usage_schema_unrecognized');
 });
});

describe('Codex observer',()=>{
 it('accepts the pasted loopback redirect, keeps the ChatGPT account id, and writes a refresh-less auth.json',async()=>{
  const begun=codex.begin({random});
  expect(new URL(begun.authorization_url).searchParams.get('redirect_uri')).toBe('http://localhost:1455/auth/callback');
  const idToken=jwt({'https://api.openai.com/auth':{chatgpt_account_id:'acct_123'}});
  const send=fetchJson((url,init)=>{
   const body=new URLSearchParams(init.body as string);
   expect(url).toBe('https://auth.openai.com/oauth/token');
   if(body.get('grant_type')==='authorization_code'){expect(body.get('code')).toBe('xyz');expect(body.get('code_verifier')).toBe(begun.pending.verifier);return{access_token:jwt({exp:1_760_000_000}),refresh_token:'rt',id_token:idToken};}
   expect(body.get('refresh_token')).toBe('rt');return{access_token:jwt({exp:1_760_100_000}),refresh_token:'rt2',id_token:idToken};
  });
  const granted=await codex.complete(begun.pending,`http://localhost:1455/auth/callback?code=xyz&state=${begun.pending.state}`,{fetch:send,now:clock});
  expect(granted.claims.account_id).toBe('acct_123');expect(granted.expires_at).toBe(1_760_000_000_000);
  await expect(codex.complete(begun.pending,'http://localhost:1455/auth/callback?code=xyz&state=nope',{fetch:send})).rejects.toThrow('enrollment_state_mismatch');
  const refreshed=await codex.refresh(granted,{fetch:send,now:clock});
  expect(refreshed.refresh_token).toBe('rt2');
  const usage=fetchJson((url,init)=>{expect(url).toBe('https://chatgpt.com/backend-api/wham/usage');expect((init.headers as Record<string,string>)['ChatGPT-Account-Id']).toBe('acct_123');
   return{plan_type:'plus',rate_limit:{allowed:true,primary_window:{used_percent:40,limit_window_seconds:18000,reset_after_seconds:600},secondary_window:{used_percent:10,limit_window_seconds:604800,reset_at:1_791_158_400}},credits:{has_credits:true,unlimited:false,balance:'12.5'}};});
  const reading=await codex.readUsage(refreshed,'codex-personal',{fetch:usage,now:clock});
  expect(reading.allowed).toBe(true);
  expect(reading.snapshot.limits.map(b=>[b.kind,b.reset_at,Number(b.remaining_fraction!.toFixed(2))])).toEqual([['session','2026-10-01T12:10:00.000Z',0.6],['weekly','2026-10-05T00:00:00.000Z',0.9]]);
  expect(reading.snapshot.metadata.paid_usage?.[0]).toMatchObject({unit:'credits',remaining:12.5});
  const [file]=codex.credentialFiles(refreshed,'linux');
  expect(file.path).toBe('auth.json');expect(JSON.parse(file.content).tokens).toMatchObject({refresh_token:'',account_id:'acct_123'});expect(file.content).not.toContain('rt2');
 });
 it('treats an unrecognized usage body as a schema problem',()=>{expect(()=>codexUsage({plan_type:'plus'},'claude-c',now)).toThrow('usage_schema_unrecognized');});
});

describe('Cursor observer',()=>{
 it('polls the CLI hand-off, distinguishes pending from rejected, and writes a platform-specific store',async()=>{
  const begun=cursor.begin({random});
  const url=new URL(begun.authorization_url);expect(url.origin+url.pathname).toBe('https://cursor.com/loginDeepControl');expect(url.searchParams.get('uuid')).toBe(begun.pending.state);
  const pending=vi.fn(async()=>new Response('',{status:404})) as unknown as typeof fetch;
  await expect(cursor.complete(begun.pending,'',{fetch:pending})).rejects.toThrow('enrollment_pending');
  const token=jwt({exp:1_760_000_000});
  const done=fetchJson(url=>{const u=new URL(url);expect(u.searchParams.get('verifier')).toBe(begun.pending.verifier);return{accessToken:token,refreshToken:'crt',authId:'auth0|x'};});
  const granted=await cursor.complete(begun.pending,'',{fetch:done,now:clock});
  expect(granted).toMatchObject({access_token:token,refresh_token:'crt',expires_at:1_760_000_000_000});
  expect(cursor.credentialFiles(granted,'linux')[0]).toEqual({path:'config/cursor/auth.json',content:JSON.stringify({accessToken:token})});
  expect(cursor.credentialFiles(granted,'darwin')[0].path).toBe('~/.cursor/auth.json');
  const usage=fetchJson(url=>url.endsWith('GetPlanInfo')?{planInfo:{includedUsageResetsAt:'1791158400000',includedUsagePeriod:'WEEKLY'}}:{billingCycleEnd:'1793491200000',planUsage:{totalPercentUsed:30,autoPercentUsed:10,apiPercentUsed:50},spendLimitUsage:{individualLimit:5000,individualUsed:100,individualRemaining:4900}});
  const reading=await cursor.readUsage(granted,'cursor-personal',{fetch:usage,now:clock});
  expect(reading.snapshot.limits.map(b=>[b.scope,b.kind,b.reset_at])).toEqual([['all_models','weekly','2026-10-05T00:00:00.000Z'],['cursor_auto','weekly','2026-10-05T00:00:00.000Z'],['cursor_api','weekly','2026-10-05T00:00:00.000Z']]);
 });
 it('rejects unrecognized usage shapes',()=>{expect(()=>cursorUsage({billingCycleEnd:'1793491200000',planUsage:{}},'claude-c',now)).toThrow('usage_schema_unrecognized');});
 it('never leaks tokens through readings',async()=>{
  const g:Grant={access_token:'secret-access',refresh_token:'secret-refresh',expires_at:null,claims:{},extra_tokens:{}};
  const usage=fetchJson(url=>url.endsWith('GetPlanInfo')?{}:{billingCycleEnd:'1793491200000',planUsage:{totalPercentUsed:1}});
  expect(JSON.stringify(await cursor.readUsage(g,'cursor-personal',{fetch:usage,now:clock}))).not.toContain('secret');
 });
});

describe('Gemini observer',()=>{
 it('runs the CLI code-paste flow, discovers the Code Assist project, reads per-model quota and writes a refresh-less store',async()=>{
  const {gemini}=await import('../src/index');
  const begun=gemini.begin({random});
  const url=new URL(begun.authorization_url);
  expect(url.origin+url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(url.searchParams.get('redirect_uri')).toBe('https://codeassist.google.com/authcode');expect(url.searchParams.get('access_type')).toBe('offline');
  const send=fetchJson((u,init)=>{
   if(u==='https://oauth2.googleapis.com/token'){const body=new URLSearchParams(init.body as string);
    if(body.get('grant_type')==='authorization_code'){expect(body.get('code')).toBe('4/abc');expect(body.get('code_verifier')).toBe(begun.pending.verifier);return{access_token:'ga1',refresh_token:'gr1',expires_in:3599,id_token:jwt({email:'x@example.com'})};}
    expect(body.get('refresh_token')).toBe('gr1');return{access_token:'ga2',expires_in:3599};}
   if(u.endsWith(':loadCodeAssist'))return{cloudaicompanionProject:'proj-123',currentTier:{id:'standard-tier',name:'Google AI Pro'}};
   if(u.endsWith(':retrieveUserQuota')){expect(JSON.parse(init.body as string)).toEqual({project:'proj-123'});
    return{buckets:[{modelId:'gemini-2.5-pro',tokenType:'REQUESTS',remainingFraction:0.4,resetTime:'2026-10-02T07:00:00Z'},{modelId:'gemini-2.5-flash',tokenType:'REQUESTS',remainingFraction:0.9,resetTime:'2026-10-02T07:00:00Z'}]};}
   throw new Error('unexpected '+u);
  });
  const granted=await gemini.complete(begun.pending,'4/abc',{fetch:send,now:clock});
  expect(granted).toMatchObject({refresh_token:'gr1',expires_at:clock()+3_599_000,claims:{project:'proj-123',tier:'Google AI Pro'}});
  const refreshed=await gemini.refresh(granted,{fetch:send,now:clock});
  expect(refreshed).toMatchObject({access_token:'ga2',refresh_token:'gr1',claims:{project:'proj-123'}});
  const reading=await gemini.readUsage(refreshed,'google-ai-pro-personal',{fetch:send,now:clock});
  expect(reading.snapshot.limits.map(b=>[b.scope,b.kind,Number(b.remaining_fraction!.toFixed(2)),b.confidence])).toEqual([['all_models','daily',0.4,'estimated'],['gemini_2_5_pro','daily',0.4,'provider_reported'],['gemini_2_5_flash','daily',0.9,'provider_reported']]);
  expect(reading.snapshot.metadata.display_label).toBe('Google AI Pro');
  const [file]=gemini.credentialFiles(refreshed,'linux');
  expect(file.path).toBe('.gemini/oauth_creds.json');expect(JSON.parse(file.content)).toMatchObject({access_token:'ga2',refresh_token:'',token_type:'Bearer'});expect(file.content).not.toContain('gr1');
 });
 it('rejects quota bodies without request buckets',async()=>{
  const {normalizeUsage}=await import('../src/gemini');
  expect(()=>normalizeUsage({buckets:[{modelId:'x',tokenType:'TOKENS',remainingFraction:0.5}]},'google-c',now)).toThrow('usage_schema_unrecognized');
  expect(()=>normalizeUsage({},'google-c',now)).toThrow('usage_schema_unrecognized');
 });
});
