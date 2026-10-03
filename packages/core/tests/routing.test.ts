import { describe,it,expect } from 'vitest';
import { route, freshness, ingestSnapshot, type AccountState } from '../src/index';
const now=new Date('2026-09-24T09:00:00.000Z');
function account(id:string,session:number,weekly:number,overrides:Partial<AccountState>={}):AccountState {
  return {id,provider:'anthropic',label:id,plan:null,enabled:true,capabilities:['coding'],model_classes:['high_reasoning'],priority:0,
    status:'available',freshness:'fresh',observed_at:'2026-09-24T08:58:00.000Z',latest_refresh_at:'2026-09-24T08:58:00.000Z',limits:
    [ ['session',session,'2026-09-24T10:00:00.000Z'],['weekly',weekly,'2026-09-28T00:00:00.000Z'] ].map(([kind,remaining,reset])=>({
      id:String(kind),account_id:id,kind:String(kind),scope:'all_models',unit:'fraction',window_seconds:null,used:null,limit:null,remaining:null,
      used_fraction:1-Number(remaining),remaining_fraction:Number(remaining),window_started_at:null,reset_at:String(reset),
      observed_at:'2026-09-24T08:58:00.000Z',source:'provider_ui',confidence:'provider_reported',metadata:{}})),...overrides};
}
describe('routing',()=>{
  it('supports multiple accounts of the same provider and filters capabilities',()=>{
    expect(route([account('claude-personal',.7,.7),account('claude-work',.8,.8)],{now,capability:'coding'}).recommended?.account_id).toBe('claude-work');
    expect(route([account('claude-work',.8,.8)],{now,capability:'images'}).recommended).toBeNull();
  });
  it('never selects exhausted or reserved weekly capacity',()=>{
    const result=route([account('work',.95,.12),account('personal',.5,.55),account('empty',0,.8)],{now});
    expect(result.recommended?.account_id).toBe('personal');
    expect(result.candidates.find(c=>c.account_id==='work')?.exclusions).toContain('reserve:weekly');
    expect(result.candidates.find(c=>c.account_id==='empty')?.exclusions).toContain('exhausted');
  });
  it('favors imminent reset only for similar usable capacity',()=>{
    const soon=account('soon',.70,.8), later=account('later',.76,.8);
    later.limits[0]!.reset_at='2026-09-24T14:00:00.000Z';
    expect(route([soon,later],{now}).recommended?.account_id).toBe('later');
    later.limits[0]!.remaining_fraction=.74;
    expect(route([soon,later],{now}).recommended?.account_id).toBe('soon');
  });
  it('rejects stale, failed, passed reset and unknown data',()=>{
    const stale=account('stale',.9,.9,{freshness:'stale'}), failed=account('failed',.9,.9,{status:'error'}), expired=account('expired',.9,.9);
    expired.limits[0]!.reset_at='2026-09-24T08:59:59.000Z';
    const r=route([stale,failed,expired],{now});
    expect(r.recommended).toBeNull();
    expect(r.candidates.map(c=>c.exclusions[0])).toEqual(['stale','unhealthy','reset_passed']);
  });
  it('handles DST and UTC midnight without changing reported reset',()=>{
    const a=account('a',.7,.7); a.limits[0]!.reset_at='2026-11-01T06:00:00.000Z';
    expect(route([a],{now}).candidates[0]?.next_reset_at).toBe('2026-09-28T00:00:00.000Z');
    expect(freshness('2026-09-24T08:50:00.000Z',now)).toBe('fresh');
    expect(freshness('2026-09-24T07:59:00.000Z',now)).toBe('seriously_stale');
  });
  it('rejects malformed payloads but accepts a new bucket kind',()=>{
    const bucket=account('account-a',.7,.7).limits[0]!;
    const snapshot={account_id:'account-a',provider:'anthropic',observed_at:bucket.observed_at,status:'ok',limits:[{...bucket,kind:'monthly'}]};
    expect(ingestSnapshot.safeParse(snapshot).success).toBe(true);
    expect(ingestSnapshot.safeParse({...snapshot,limits:[{...bucket,reset_at:'tomorrow'}]}).success).toBe(false);
    expect(ingestSnapshot.safeParse({...snapshot,limits:[{...bucket,metadata:{html:'<cookie>'}}]}).success).toBe(false);
  });
});

it('paid balances do not alter subscription routing or override exhaustion',()=>{
 const empty=account('empty',0,0);const paid={id:'credits',label:'Paid credits',kind:'balance' as const,unit:'credits' as const,remaining:100000,used:null,limit:null,enabled:true,unlimited:false,observed_at:empty.observed_at!,reset_at:null};
 expect(route([{...empty,paid_usage:[paid]}],{now}).recommended).toBeNull();
 expect(route([{...account('available',.5,.5),paid_usage:[paid]}],{now}).recommended?.account_id).toBe('available');
});
