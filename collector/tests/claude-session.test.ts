import {afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtemp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {accessToken,clientId,sessionPath,tokenEndpoint} from '../src/providers/claude/session';
import {collectUsage} from '../src/usage';
import type {Target} from '../src/providers/types';

const now=1_760_000_000_000;
const clock=()=>now;
async function withStore(oauth:Record<string,unknown>,run:(dir:string)=>Promise<void>){
  const dir=await mkdtemp(join(tmpdir(),'claude-session-'));
  try{
    await writeFile(sessionPath(dir),JSON.stringify({claudeAiOauth:oauth,otherTool:{keep:'me'}}));
    await run(dir);
  }finally{await rm(dir,{recursive:true,force:true});}
}
afterEach(()=>vi.unstubAllGlobals());

describe('Claude session access token',()=>{
 it('uses a stored token that is still valid without contacting the token endpoint',async()=>withStore({accessToken:'live',refreshToken:'r1',expiresAt:now+3_600_000},async dir=>{
  const send=vi.fn();
  expect(await accessToken(dir,{fetch:send as unknown as typeof fetch,now:clock})).toEqual({token:'live',refreshed:false});
  expect(send).not.toHaveBeenCalled();
 }));
 it('exchanges the refresh token when expired and stores the rotated session like the CLI does',async()=>withStore({accessToken:'old',refreshToken:'r1',expiresAt:now-1,scopes:['user:inference'],subscriptionType:'max'},async dir=>{
  const send=vi.fn(async(url:string,init:RequestInit)=>{
   expect(url).toBe(tokenEndpoint);expect(init.method).toBe('POST');expect(init.redirect).toBe('error');
   expect(JSON.parse(init.body as string)).toEqual({grant_type:'refresh_token',refresh_token:'r1',client_id:clientId});
   return Response.json({access_token:'new',refresh_token:'r2',expires_in:28800,scope:'user:inference'});
  });
  expect(await accessToken(dir,{fetch:send as unknown as typeof fetch,now:clock})).toEqual({token:'new',refreshed:true});
  const stored=JSON.parse(await readFile(sessionPath(dir),'utf8'));
  expect(stored).toEqual({claudeAiOauth:{accessToken:'new',refreshToken:'r2',expiresAt:now+28_800_000,scopes:['user:inference'],subscriptionType:'max'},otherTool:{keep:'me'}});
  expect((await stat(sessionPath(dir))).mode&0o777).toBe(0o600);
  expect(await readdir(dir)).toEqual(['.credentials.json']);
 }));
 it('refreshes shortly before expiry',async()=>withStore({accessToken:'old',refreshToken:'r1',expiresAt:now+60_000},async dir=>{
  const send=vi.fn(async()=>Response.json({access_token:'new'}));
  expect(await accessToken(dir,{fetch:send as unknown as typeof fetch,now:clock})).toEqual({token:'new',refreshed:true});
  expect(JSON.parse(await readFile(sessionPath(dir),'utf8')).claudeAiOauth).toMatchObject({accessToken:'new',refreshToken:'r1',expiresAt:now+60_000});
 }));
 it('keeps a session the CLI rotated concurrently instead of overwriting it',async()=>withStore({accessToken:'old',refreshToken:'r1',expiresAt:now-1},async dir=>{
  const send=vi.fn(async()=>{
   await writeFile(sessionPath(dir),JSON.stringify({claudeAiOauth:{accessToken:'cli',refreshToken:'r9',expiresAt:now+99}}));
   return Response.json({access_token:'mine',refresh_token:'r2',expires_in:100});
  });
  expect(await accessToken(dir,{fetch:send as unknown as typeof fetch,now:clock})).toEqual({token:'cli',refreshed:false});
  expect(JSON.parse(await readFile(sessionPath(dir),'utf8')).claudeAiOauth).toEqual({accessToken:'cli',refreshToken:'r9',expiresAt:now+99});
 }));
 it('reports auth problems without touching the store',async()=>{
  await withStore({accessToken:'old',expiresAt:now-1},async dir=>{
   const send=vi.fn();
   await expect(accessToken(dir,{fetch:send as unknown as typeof fetch,now:clock})).rejects.toThrow('usage_auth_required');
   expect(send).not.toHaveBeenCalled();
  });
  for(const [status,code] of [[400,'usage_auth_required'],[401,'usage_auth_required'],[500,'usage_http_error']] as const){
   await withStore({accessToken:'old',refreshToken:'r1',expiresAt:now-1},async dir=>{
    const send=vi.fn(async()=>new Response('{"error":"invalid_grant","secret":"body"}',{status}));
    await expect(accessToken(dir,{fetch:send as unknown as typeof fetch,now:clock})).rejects.toThrow(code);
    expect(JSON.parse(await readFile(sessionPath(dir),'utf8')).claudeAiOauth).toEqual({accessToken:'old',refreshToken:'r1',expiresAt:now-1});
   });
  }
  await withStore({accessToken:'old',refreshToken:'r1',expiresAt:now-1},async dir=>{
   const send=vi.fn(async()=>Response.json({unexpected:true}));
   await expect(accessToken(dir,{fetch:send as unknown as typeof fetch,now:clock})).rejects.toThrow('usage_auth_required');
  });
 });
 it('collects usage through a refreshed session and never leaks tokens',async()=>withStore({accessToken:'old-secret',refreshToken:'refresh-secret',expiresAt:Date.now()-1},async dir=>{
  const send=vi.fn(async(url:string,init:RequestInit)=>{
   if(url===tokenEndpoint)return Response.json({access_token:'new-secret',refresh_token:'rotated-secret',expires_in:3600});
   expect(url).toBe('https://api.anthropic.com/api/oauth/usage');
   expect(init.headers).toMatchObject({Authorization:'Bearer new-secret'});
   return Response.json({five_hour:{utilization:10,resets_at:'2026-10-01T18:00:00Z'},seven_day:{utilization:20,resets_at:'2026-10-05T00:00:00Z'}});
  });
  vi.stubGlobal('fetch',send);
  const result=await collectUsage({auth_dir:dir,account_id:'claude-personal',provider:'anthropic'} as Target);
  expect(result.snapshot.status).toBe('ok');
  expect(result.snapshot.limits.map(b=>[b.kind,b.reset_at])).toEqual([['session','2026-10-01T18:00:00.000Z'],['weekly','2026-10-05T00:00:00.000Z']]);
  expect(JSON.stringify(result)).not.toContain('secret');
 }));
});
