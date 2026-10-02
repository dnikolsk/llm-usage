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
