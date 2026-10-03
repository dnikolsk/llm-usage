import {it,expect} from 'vitest';
import type {AccountState,UsageBucket} from '@llm-usage/core';
import {liveRemaining,reset,primaryBuckets} from '../src/dashboard-display';
const now=new Date('2026-10-01T18:00:00Z');
const bucket={id:'included',scope:'all_models',observed_at:now.toISOString(),reset_at:null,remaining_fraction:.9} as UsageBucket;
const account={status:'available',provider:'cursor',limits:[bucket,{...bucket,id:'auto',scope:'cursor_auto'},{...bucket,id:'api',scope:'cursor_api'}]} as AccountState;
it('does not present expired, stale or failed usage as current capacity',()=>{
 expect(liveRemaining(account,bucket,now)).toBe(.9);
 expect(liveRemaining(account,{...bucket,reset_at:now.toISOString()},now)).toBeNull();
 expect(liveRemaining(account,{...bucket,observed_at:'2026-10-01T17:00:00Z'},now)).toBeNull();
 expect(liveRemaining({...account,status:'error'},bucket,now)).toBeNull();
 expect(reset(null,now)).toBe('Reset not reported');
});
it('keeps both Cursor pools visible alongside the combined allowance',()=>{
 expect(primaryBuckets(account).map(b=>b.scope)).toEqual(['all_models','cursor_auto','cursor_api']);
});

it('formats visible reset dates and distinguishes paid dollars from provider credits',async()=>{
 const {time,paidAmount,paidCurrent}=await import('../src/dashboard-display');
 expect(time('2026-10-04T05:00:00Z')).toContain('Oct 4');expect(time(null)).toBe('Not reported');
 expect(paidAmount(7500,'usd_cents')).toBe('$75.00');expect(paidAmount(125.5,'credits')).toBe('125.5 credits');expect(paidAmount(null,'credits')).toBe('Not reported');
 const p={observed_at:now.toISOString(),reset_at:null} as import('@llm-usage/core').PaidUsage;
 expect(paidCurrent(account,p,now)).toBe(true);expect(paidCurrent({...account,status:'error'},p,now)).toBe(false);
 expect(paidCurrent(account,{...p,observed_at:'2026-10-01T17:00:00Z'},now)).toBe(false);expect(paidCurrent(account,{...p,reset_at:now.toISOString()},now)).toBe(false);
});
