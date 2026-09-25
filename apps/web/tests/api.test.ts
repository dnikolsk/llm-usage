import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountState } from '@llm-usage/core';
vi.mock('../src/store',()=>({ingest:vi.fn(),getStatus:vi.fn(),getPolicy:vi.fn()}));
import { ingest,getStatus,getPolicy } from '../src/store';
import { POST } from '../app/v1/ingest/route';
import { GET as STATUS } from '../app/v1/status/route';
import { GET as ROUTE } from '../app/v1/route/route';

const read='r'.repeat(40),write='w'.repeat(40);
const account:AccountState={id:'claude-work',provider:'anthropic',label:'Claude Work',plan:'Team',enabled:true,
  capabilities:['coding'],model_classes:['high_reasoning'],priority:0,status:'available',freshness:'fresh',
  observed_at:new Date().toISOString(),latest_refresh_at:new Date().toISOString(),limits:[{
    id:'session',account_id:'claude-work',kind:'session',scope:'all_models',unit:'fraction',used:null,limit:null,remaining:null,
    used_fraction:.28,remaining_fraction:.72,window_started_at:null,reset_at:new Date(Date.now()+3_600_000).toISOString(),
    observed_at:new Date().toISOString(),source:'provider_ui',confidence:'provider_reported',metadata:{}
  }]};
beforeEach(()=>{
  process.env.READ_TOKEN=read;process.env.WRITE_TOKEN=write;
  vi.mocked(getStatus).mockResolvedValue({generated_at:new Date().toISOString(),accounts:[account]});
  vi.mocked(getPolicy).mockResolvedValue({reserves:{session:.1,weekly:.15}});
  vi.mocked(ingest).mockResolvedValue('created');
});
afterEach(()=>{vi.clearAllMocks();delete process.env.READ_TOKEN;delete process.env.WRITE_TOKEN;});
describe('HTTP contract',()=>{
  it('keeps read and write credentials separate',async()=>{
    expect((await STATUS(new Request('http://localhost/v1/status',{headers:{Authorization:`Bearer ${write}`}}))).status).toBe(401);
    expect((await POST(new Request('http://localhost/v1/ingest',{method:'POST',headers:{Authorization:`Bearer ${read}`}}))).status).toBe(401);
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
