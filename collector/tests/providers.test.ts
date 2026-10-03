import {describe,it,expect} from 'vitest';
import * as codex from '../src/providers/codex/index';
import * as claude from '../src/providers/claude/index';
import * as cursor from '../src/providers/cursor/index';
import {providerEnvironment,type Target} from '../src/providers/types';
const result=(stdout:string,stderr='',code=0)=>async()=>({stdout,stderr,code});
describe('official CLI boundaries',()=>{
 it('does not accept Codex API-key login as a subscription',async()=>{
  expect(await codex.authenticated(result('','Logged in using ChatGPT'))).toBe(true);
  expect(await codex.authenticated(result('','Logged in using an API key'))).toBe(false);
 });
 it('distinguishes Claude subscription login from API usage',async()=>{
  expect(await claude.authenticated(result(JSON.stringify({loggedIn:true,authMethod:'claude.ai'})))).toBe(true);
  expect(await claude.authenticated(result(JSON.stringify({loggedIn:true,authMethod:'api_key'})))).toBe(false);
 });
 it('requires an authenticated Cursor response',async()=>{
  expect(await cursor.authenticated(result(JSON.stringify({isAuthenticated:false,hasAccessToken:false})))).toBe(false);
 });
 it('rejects cached Cursor login when the backend rejects tokens',async()=>{
  const calls:string[][]=[];
  expect(await cursor.authenticated(async args=>{
    calls.push(args);
    return args[0]==='status'
      ?{code:0,stdout:JSON.stringify({isAuthenticated:true,hasAccessToken:true,message:'Logged in (unable to fetch user details)'}),stderr:''}
      :{code:1,stdout:'',stderr:'Authentication failed: credentials invalid or expired'};
  })).toBe(false);
  expect(calls).toEqual([['status','--format','json'],['models']]);
 });
 it('requires a live nonempty model list for Cursor readiness',async()=>{
  for(const [stdout,code,expected] of [['Available models\nsonnet - Sonnet',0,true],['No models available for this account.',0,false],['Available models',1,false]] as const){
    expect(await cursor.authenticated(async args=>args[0]==='status'
      ?{code:0,stdout:JSON.stringify({isAuthenticated:true,hasAccessToken:true}),stderr:''}
      :{code,stdout,stderr:''})).toBe(expected);
  }
 });
 it('uses headless Cursor args with trust and sandbox, never force or yolo',()=>{
  expect(cursor.localArgs()).toEqual(['-p','--output-format','stream-json','--sandbox','enabled','--trust']);
  expect(cursor.localArgs('sess-1')).toEqual(['-p','--output-format','stream-json','--sandbox','enabled','--trust','--resume','sess-1']);
  for (const args of [cursor.localArgs(), cursor.localArgs('sess-1')]) {
    expect(args).toContain('--sandbox');
    expect(args).toContain('enabled');
    expect(args).toContain('--trust');
    expect(args).not.toContain('--force');
    expect(args).not.toContain('--yolo');
  }
 });
 it('does not mistake an exit code for task completion',()=>{
  expect(codex.localResult('{"type":"error"}').complete).toBe(false);
  expect(claude.localResult('{"type":"result","subtype":"error_max_turns"}').complete).toBe(false);
  expect(cursor.localResult('{"type":"result","subtype":"success","result":"Done"}').complete).toBe(true);
 });
 it('keeps host API keys out of the provider environment',()=>{
  process.env.ANTHROPIC_API_KEY='test-only';
  const env=providerEnvironment({provider:'anthropic',auth_dir:'/tmp/test-auth'} as Target);
  expect(env.ANTHROPIC_API_KEY).toBeUndefined();expect(env.CLAUDE_CONFIG_DIR).toBe('/tmp/test-auth');
  delete process.env.ANTHROPIC_API_KEY;
 });
 it('recognizes cloud task URLs and terminal states without executing them',()=>{
  expect(codex.cloudTaskUrl('https://chatgpt.com/codex/tasks/task_123')).toContain('task_123');
  expect(codex.cloudTaskUrl('https://evil.example/task_123')).toBeUndefined();
  expect(codex.cloudState('[READY] A task')).toBe('ready');expect(codex.cloudState('some failure')).toBe('unknown');
 });
});
