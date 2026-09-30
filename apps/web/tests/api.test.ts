import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountState } from '@llm-usage/core';
vi.mock('../src/store',()=>({ingest:vi.fn(),getStatus:vi.fn(),getPolicy:vi.fn()}));
vi.mock('../src/jev',()=>({evaluateTask:vi.fn(),JevUnavailable:class extends Error {}}));
import { ingest,getStatus,getPolicy } from '../src/store';
import { evaluateTask, JevUnavailable } from '../src/jev';
import { POST } from '../app/v1/ingest/route';
import { GET as STATUS } from '../app/v1/status/route';
import { GET as ROUTE, POST as TASK_ROUTE } from '../app/v1/route/route';

const read='r'.repeat(40),write='w'.repeat(40);
const account:AccountState={id:'claude-work',provider:'anthropic',label:'Claude Work',plan:'Team',enabled:true,
  capabilities:['coding'],model_classes:['high_reasoning'],priority:0,status:'available',freshness:'fresh',
  observed_at:new Date().toISOString(),latest_refresh_at:new Date().toISOString(),limits:[{
    id:'session',account_id:'claude-work',kind:'session',scope:'all_models',unit:'fraction',window_seconds:18000,used:null,limit:null,remaining:null,
    used_fraction:.28,remaining_fraction:.72,window_started_at:null,reset_at:new Date(Date.now()+3_600_000).toISOString(),
    observed_at:new Date().toISOString(),source:'provider_ui',confidence:'provider_reported',metadata:{}
  }]};
beforeEach(()=>{
  process.env.READ_TOKEN=read;process.env.WRITE_TOKEN=write;
  vi.mocked(getStatus).mockResolvedValue({generated_at:new Date().toISOString(),accounts:[account]});
  vi.mocked(getPolicy).mockResolvedValue({reserves:{session:.1,weekly:.15}});
  vi.mocked(ingest).mockResolvedValue('created');
  vi.mocked(evaluateTask).mockResolvedValue({difficulty:1,workSize:1,interactive:.2,needsMac:.1,model:'jev-test',confidence:.9});
});
afterEach(()=>{vi.clearAllMocks();delete process.env.READ_TOKEN;delete process.env.WRITE_TOKEN;});
describe('HTTP contract',()=>{
  it('keeps read and write credentials separate',async()=>{
    expect((await STATUS(new Request('http://localhost/v1/status',{headers:{Authorization:`Bearer ${write}`}}))).status).toBe(401);
    expect((await POST(new Request('http://localhost/v1/ingest',{method:'POST',headers:{Authorization:`Bearer ${read}`}}))).status).toBe(401);
    process.env.WRITE_TOKEN=read;
    expect((await STATUS(new Request('http://localhost/v1/status',{headers:{Authorization:`Bearer ${read}`}}))).status).toBe(401);
  });
  it('returns normalized status in one call',async()=>{
    const res=await STATUS(new Request('http://localhost/v1/status',{headers:{Authorization:`Bearer ${read}`}}));
    expect(res.status).toBe(200);
    expect((await res.json()).accounts[0].limits[0].reset_at).toBe(account.limits[0]?.reset_at);
  });
  it('routes only eligible accounts and returns alternatives',async()=>{
    vi.mocked(getStatus).mockResolvedValue({generated_at:new Date().toISOString(),accounts:[account,{...account,id:'claude-personal',limits:account.limits.map(b=>({...b,account_id:'claude-personal',remaining_fraction:.65,used_fraction:.35}))}]});
    const res=await ROUTE(new Request('http://localhost/v1/route?capability=coding',{headers:{Authorization:`Bearer ${read}`}}));
    const data=await res.json();
    expect(data.recommended.account_id).toBe('claude-work');
    expect(data.alternatives).toEqual([{account_id:'claude-personal',provider:'anthropic'}]);
    expect(data.reason.policy_reserves.weekly).toBe(.15);
  });
  it('requires a read token and a valid task before calling Jev',async()=>{
    const url='http://localhost/v1/route';
    expect((await TASK_ROUTE(new Request(url,{method:'POST',body:JSON.stringify({task:'Fix the dashboard layout'})}))).status).toBe(401);
    expect((await TASK_ROUTE(new Request(url,{method:'POST',headers:{Authorization:`Bearer ${read}`},
      body:JSON.stringify({task:'short'})}))).status).toBe(400);
    expect(evaluateTask).not.toHaveBeenCalled();
  });
  it('returns a task-aware app, model and execution recommendation',async()=>{
    const res=await TASK_ROUTE(new Request('http://localhost/v1/route',{method:'POST',
      headers:{Authorization:`Bearer ${read}`,'Content-Type':'application/json'},
      body:JSON.stringify({task:'Continue the dashboard implementation',project:{stage:'ongoing',current_account_id:'claude-work'},
        interaction_level:'high',needs_mac:true,capability:'coding'})}));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body=await res.json();
    expect(body.recommended).toMatchObject({account_id:'claude-work',model_id:'claude-sonnet',execution:'local'});
    expect(body.reason.project_continuity).toBe(true);
    expect(body.decision_source).toBe('jev');
  });
  it('rejects empty, too-short, and unauthenticated task routes (G7, G8)',async()=>{
    const url='http://localhost/v1/route';
    const post=(body:unknown,auth=true)=>TASK_ROUTE(new Request(url,{method:'POST',
      headers:auth?{Authorization:`Bearer ${read}`}:{},body:JSON.stringify(body)}));
    for (const task of ['','hi there']) {
      const res=await post({task});
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({error:'invalid_request'});
    }
    const res=await post({task:'Fix a typo in the README title'},false);
    expect(res.status).toBe(401);
    expect((await TASK_ROUTE(new Request(url,{method:'POST',headers:{Authorization:`Bearer ${write}`},
      body:JSON.stringify({task:'Fix a typo in the README title'})}))).status).toBe(401);
    expect(evaluateTask).not.toHaveBeenCalled();
  });
  it('explains exhausted peers and refuses cloud on low Jev confidence (G3, G9)',async()=>{
    const exhausted=(id:string,provider:string,model_classes:string[])=>({...account,id,provider,model_classes,
      limits:account.limits.map(b=>({...b,account_id:id,remaining_fraction:0,used_fraction:1}))});
    vi.mocked(getStatus).mockResolvedValue({generated_at:new Date().toISOString(),accounts:[account,
      exhausted('cursor-personal','cursor',['cursor_models','other_models']),exhausted('chatgpt-personal','openai',['work_codex'])]});
    vi.mocked(evaluateTask).mockResolvedValue({difficulty:1.9,workSize:1.9,interactive:.1,needsMac:.1,model:'jev-test',confidence:.28});
    const res=await TASK_ROUTE(new Request('http://localhost/v1/route',{method:'POST',headers:{Authorization:`Bearer ${read}`},
      body:JSON.stringify({task:'Build a new multi-screen application',estimated_work:'large',interaction_level:'low',
        needs_mac:false,repo_pushed:true})}));
    const body=await res.json();
    expect(body.recommended).toMatchObject({account_id:'claude-work',model_id:'claude-opus',execution:'local'});
    expect(body.handoff).toBeNull();
    expect(body.warnings).toContain('low_jev_confidence');
    for (const id of ['cursor-personal','chatgpt-personal'])
      expect(body.candidates.find((c:{account_id:string})=>c.account_id===id).exclusions).toContain('exhausted');
  });
  it('reports Jev unavailability instead of pretending a deterministic choice used Jev',async()=>{
    vi.mocked(evaluateTask).mockRejectedValueOnce(new JevUnavailable('down'));
    const res=await TASK_ROUTE(new Request('http://localhost/v1/route',{method:'POST',headers:{Authorization:`Bearer ${read}`},
      body:JSON.stringify({task:'Build a substantial new feature'})}));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({error:'jev_unavailable'});
  });
  it('rejects malformed payload before touching the database',async()=>{
    const res=await POST(new Request('http://localhost/v1/ingest',{method:'POST',headers:{Authorization:`Bearer ${write}`,'Idempotency-Key':'valid-key-1234567','Content-Type':'application/json'},body:JSON.stringify({account_id:'claude-work',html:'<cookie>'})}));
    expect(res.status).toBe(400);
    expect(ingest).not.toHaveBeenCalled();
  });
  it('returns 200 on idempotent retry and 409 on key conflict',async()=>{
    const observed=new Date().toISOString();
    const make=()=>new Request('http://localhost/v1/ingest',{method:'POST',headers:{Authorization:`Bearer ${write}`,'Idempotency-Key':'valid-key-1234567','Content-Type':'application/json'},body:JSON.stringify({account_id:'claude-work',provider:'anthropic',observed_at:observed,status:'error',limits:[]})});
    vi.mocked(ingest).mockResolvedValueOnce('duplicate').mockResolvedValueOnce('conflict');
    expect((await POST(make())).status).toBe(200);
    expect((await POST(make())).status).toBe(409);
  });
});
